import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const userHome = process.env.USERPROFILE ?? process.env.HOME ?? "";

type JsonObject = Record<string, unknown>;

type IssueSortBy = "priority" | "createdAt" | "updatedAt" | "dueDate";
type SortOrder = "Ascending" | "Descending";

const paginationOrderByHint =
  "Linear PaginationOrderBy only supports createdAt and updatedAt. To sort issues by priority, due date, title, etc., use the issues sort argument, e.g. sort: [{ priority: { order: Descending, noPriorityFirst: false } }], not orderBy: priority.";

function linearGraphqlHint(message: string): string | undefined {
  if (message.includes('"PaginationOrderBy" enum')) return paginationOrderByHint;
  if (message.includes('"PaginationSortOrder" enum')) return "Linear PaginationSortOrder values are case-sensitive: Ascending or Descending.";
  if (message.includes('"PaginationNulls" enum')) return "Linear PaginationNulls values are case-sensitive: first or last.";
}

type LinearAuth = {
  header: string;
  source: string;
};

function readEnvLikeValue(name: string): string | undefined {
  for (const file of [".env", ".bashrc", ".bash_profile", ".profile", ".zshrc"]) {
    const path = file === ".env" ? join(process.cwd(), file) : join(userHome, file);
    try {
      const text = readFileSync(path, "utf8");
      const match = text.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(['\"]?)([^'\"\\r\\n#]+)\\1`, "m"));
      if (match?.[2]) return match[2].trim();
    } catch {}
  }
}

function getLinearAuth(): LinearAuth {
  if (process.env.LINEAR_AUTH_HEADER) {
    return { header: process.env.LINEAR_AUTH_HEADER, source: "LINEAR_AUTH_HEADER" };
  }

  const apiKey = process.env.LINEAR_API_KEY ?? process.env.LINEAR_API_TOKEN ?? readEnvLikeValue("LINEAR_API_KEY") ?? readEnvLikeValue("LINEAR_API_TOKEN");
  if (apiKey) return { header: apiKey, source: apiKey === process.env.LINEAR_API_KEY ? "LINEAR_API_KEY" : "LINEAR_API_TOKEN/.env" };

  const accessToken = process.env.LINEAR_ACCESS_TOKEN ?? process.env.LINEAR_OAUTH_TOKEN ?? readEnvLikeValue("LINEAR_ACCESS_TOKEN") ?? readEnvLikeValue("LINEAR_OAUTH_TOKEN");
  if (accessToken) return { header: `Bearer ${accessToken}`, source: "LINEAR_ACCESS_TOKEN/LINEAR_OAUTH_TOKEN" };

  throw new Error(
    "Linear credentials are not configured. Create a Linear personal API key in Settings → Account → Security & access, then set LINEAR_API_KEY. Example: export LINEAR_API_KEY=lin_api_... and restart pi (or run /reload).",
  );
}

async function linearGraphql<T = unknown>(query: string, variables: JsonObject = {}, signal?: AbortSignal): Promise<T> {
  const auth = getLinearAuth();
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth.header,
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Linear returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  if (!response.ok || payload.errors?.length) {
    const errors = payload.errors?.map((error: any) => error.message).join("; ");
    const message = errors || text.slice(0, 500);
    const hint = linearGraphqlHint(message);
    throw new Error(`Linear GraphQL failed (${response.status}): ${message}${hint ? ` Hint: ${hint}` : ""}`);
  }

  return payload.data as T;
}

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toolResult(data: unknown, extraDetails: JsonObject = {}) {
  return {
    content: [{ type: "text" as const, text: asJsonText(data) }],
    details: { data, ...extraDetails },
  };
}

function buildIssueSort(sortBy: IssueSortBy, sortOrder: SortOrder): JsonObject[] {
  const sortConfig: JsonObject = { order: sortOrder };
  if (sortBy === "priority") sortConfig.noPriorityFirst = false;
  return [{ [sortBy]: sortConfig }];
}

async function resolveTeamId(teamId: string | undefined, teamKey: string | undefined, signal?: AbortSignal): Promise<string> {
  if (teamId) return teamId;
  if (!teamKey) throw new Error("Provide either teamId or teamKey.");

  const data = await linearGraphql<{ teams: { nodes: Array<{ id: string; key: string; name: string }> } }>(
    `query TeamByKey($key: String!) {
      teams(filter: { key: { eqIgnoreCase: $key } }, first: 2) {
        nodes { id key name }
      }
    }`,
    { key: teamKey },
    signal,
  );

  const team = data.teams.nodes[0];
  if (!team) throw new Error(`No Linear team found with key ${teamKey}. Use linear_teams first.`);
  return team.id;
}

const issueFields = `
  id
  identifier
  title
  description
  priority
  estimate
  url
  createdAt
  updatedAt
  dueDate
  archivedAt
  state { id name type color }
  team { id key name }
  assignee { id name email }
  creator { id name email }
  project { id name }
  labels { nodes { id name color } }
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("linear-auth", {
    description: "Check Linear API authentication for this Pi session",
    handler: async (_args, ctx) => {
      try {
        const auth = getLinearAuth();
        const data = await linearGraphql<{ viewer: { id: string; name: string; email?: string } }>(
          `query Viewer { viewer { id name email } }`,
          {},
          ctx.signal,
        );
        ctx.ui.notify(`Linear connected as ${data.viewer.name} (${auth.source})`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerTool({
    name: "linear_viewer",
    label: "Linear Viewer",
    description: "Verify Linear access and return the authenticated Linear user.",
    promptSnippet: "Verify Linear access and show the authenticated user.",
    promptGuidelines: [
      "Use linear_viewer before Linear work if credentials or workspace access are uncertain.",
      "Linear tools require LINEAR_API_KEY, LINEAR_API_TOKEN, LINEAR_ACCESS_TOKEN, or LINEAR_AUTH_HEADER in the pi environment.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const auth = getLinearAuth();
      const data = await linearGraphql(
        `query Viewer { viewer { id name email } }`,
        {},
        signal,
      );
      return toolResult(data, { authSource: auth.source });
    },
  });

  pi.registerTool({
    name: "linear_teams",
    label: "Linear Teams",
    description: "List Linear teams and their workflow states. Use this to discover team keys/IDs and state IDs before creating or updating issues.",
    promptSnippet: "List Linear teams, team keys, team IDs, and workflow state IDs.",
    promptGuidelines: [
      "Use linear_teams to discover teamKey/teamId and workflow state IDs before creating or moving issues.",
    ],
    parameters: Type.Object({
      first: Type.Optional(Type.Number({ description: "Maximum teams to return. Default 50." })),
      includeArchived: Type.Optional(Type.Boolean({ description: "Include archived teams. Default false." })),
    }),
    async execute(_toolCallId, { first = 50, includeArchived = false }, signal) {
      const data = await linearGraphql(
        `query Teams($first: Int!, $includeArchived: Boolean!) {
          teams(first: $first, includeArchived: $includeArchived) {
            nodes {
              id key name description archivedAt
              states { nodes { id name type position color } }
            }
          }
        }`,
        { first, includeArchived },
        signal,
      );
      return toolResult(data);
    },
  });

  pi.registerTool({
    name: "linear_search_issues",
    label: "Linear Search Issues",
    description: "Search Linear issues by free-text term, with optional team boost and comment search.",
    promptSnippet: "Search Linear issues by term and return identifiers, states, teams, assignees, labels, and URLs.",
    parameters: Type.Object({
      term: Type.String({ description: "Free-text search term." }),
      teamId: Type.Optional(Type.String({ description: "Optional team UUID to boost/filter search." })),
      first: Type.Optional(Type.Number({ description: "Maximum issues to return. Default 20." })),
      includeArchived: Type.Optional(Type.Boolean({ description: "Include archived issues. Default false." })),
      includeComments: Type.Optional(Type.Boolean({ description: "Search issue comments too. Default false." })),
    }),
    async execute(_toolCallId, { term, teamId, first = 20, includeArchived = false, includeComments = false }, signal) {
      const data = await linearGraphql(
        `query SearchIssues($term: String!, $teamId: String, $first: Int!, $includeArchived: Boolean!, $includeComments: Boolean!) {
          searchIssues(term: $term, teamId: $teamId, first: $first, includeArchived: $includeArchived, includeComments: $includeComments) {
            nodes { ${issueFields} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { term, teamId, first, includeArchived, includeComments },
        signal,
      );
      return toolResult(data);
    },
  });

  pi.registerTool({
    name: "linear_list_issues",
    label: "Linear List Issues",
    description: "List Linear issues with optional filters for team key, state type/name, assignee email, priority, and safe sorting.",
    promptSnippet: "List recent Linear issues with common filters and optional sorting.",
    parameters: Type.Object({
      teamKey: Type.Optional(Type.String({ description: "Team key, e.g. ENG." })),
      stateType: Type.Optional(Type.Union([
        Type.Literal("triage"),
        Type.Literal("backlog"),
        Type.Literal("unstarted"),
        Type.Literal("started"),
        Type.Literal("completed"),
        Type.Literal("canceled"),
        Type.Literal("duplicate"),
      ], { description: "Workflow state type." })),
      stateName: Type.Optional(Type.String({ description: "Exact workflow state name." })),
      assigneeEmail: Type.Optional(Type.String({ description: "Assignee email." })),
      priority: Type.Optional(Type.Number({ description: "Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low." })),
      sortBy: Type.Optional(Type.Union([
        Type.Literal("priority"),
        Type.Literal("createdAt"),
        Type.Literal("updatedAt"),
        Type.Literal("dueDate"),
      ], { description: "Issue sort field. Use this for priority sorting instead of raw GraphQL orderBy: priority." })),
      sortOrder: Type.Optional(Type.Union([
        Type.Literal("Ascending"),
        Type.Literal("Descending"),
      ], { description: "Sort direction. Default Descending." })),
      orderBy: Type.Optional(Type.Union([
        Type.Literal("updatedAt"),
        Type.Literal("createdAt"),
      ], { description: "Basic Linear PaginationOrderBy. Only updatedAt/createdAt are valid. Default updatedAt." })),
      first: Type.Optional(Type.Number({ description: "Maximum issues to return. Default 20." })),
      includeArchived: Type.Optional(Type.Boolean({ description: "Include archived issues. Default false." })),
    }),
    async execute(_toolCallId, { teamKey, stateType, stateName, assigneeEmail, priority, sortBy, sortOrder = "Descending", orderBy = "updatedAt", first = 20, includeArchived = false }, signal) {
      const filter: JsonObject = {};
      if (teamKey) filter.team = { key: { eqIgnoreCase: teamKey } };
      if (stateType) filter.state = { type: { eq: stateType } };
      if (stateName) filter.state = { ...(filter.state as JsonObject | undefined), name: { eqIgnoreCase: stateName } };
      if (assigneeEmail) filter.assignee = { email: { eqIgnoreCase: assigneeEmail } };
      if (typeof priority === "number") filter.priority = { eq: priority };

      const sort = sortBy ? buildIssueSort(sortBy, sortOrder) : undefined;
      const data = await linearGraphql(
        `query Issues($filter: IssueFilter, $first: Int!, $includeArchived: Boolean!, $orderBy: PaginationOrderBy, $sort: [IssueSortInput!]) {
          issues(filter: $filter, first: $first, includeArchived: $includeArchived, orderBy: $orderBy, sort: $sort) {
            nodes { ${issueFields} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { filter: Object.keys(filter).length ? filter : undefined, first, includeArchived, orderBy: sort ? undefined : orderBy, sort },
        signal,
      );
      return toolResult(data, { filter, orderBy: sort ? undefined : orderBy, sort });
    },
  });

  pi.registerTool({
    name: "linear_get_issue",
    label: "Linear Get Issue",
    description: "Get a Linear issue by UUID or identifier such as ENG-123.",
    promptSnippet: "Get a Linear issue by id/identifier with comments and metadata.",
    parameters: Type.Object({
      id: Type.String({ description: "Linear issue UUID or identifier, e.g. ENG-123." }),
      includeComments: Type.Optional(Type.Boolean({ description: "Include recent comments. Default true." })),
    }),
    async execute(_toolCallId, { id, includeComments = true }, signal) {
      const commentsSelection = includeComments ? "comments(first: 20) { nodes { id body createdAt user { id name email } } }" : "";
      const data = await linearGraphql(
        `query Issue($id: String!) {
          issue(id: $id) {
            ${issueFields}
            ${commentsSelection}
          }
        }`,
        { id },
        signal,
      );
      return toolResult(data);
    },
  });

  pi.registerTool({
    name: "linear_create_issue",
    label: "Linear Create Issue",
    description: "Create a Linear issue. Provide teamId or teamKey plus a title; optional description, priority, stateId, assigneeId, projectId, labels, estimate, due date.",
    promptSnippet: "Create Linear issues with teamId/teamKey, title, markdown description, priority, state, labels, assignee, and project.",
    promptGuidelines: [
      "Before linear_create_issue, prefer discovering teamKey/teamId with linear_teams unless the user gave it explicitly.",
      "Ask for confirmation before creating many Linear issues or making destructive-looking bulk changes.",
      "Descriptions should be clear markdown with context, acceptance criteria, and implementation notes when relevant.",
    ],
    parameters: Type.Object({
      teamId: Type.Optional(Type.String({ description: "Team UUID. Either teamId or teamKey is required." })),
      teamKey: Type.Optional(Type.String({ description: "Team key, e.g. ENG. Either teamId or teamKey is required." })),
      title: Type.String({ description: "Issue title." }),
      description: Type.Optional(Type.String({ description: "Markdown issue description." })),
      priority: Type.Optional(Type.Number({ description: "Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low." })),
      stateId: Type.Optional(Type.String({ description: "Workflow state UUID." })),
      assigneeId: Type.Optional(Type.String({ description: "Assignee user UUID." })),
      projectId: Type.Optional(Type.String({ description: "Project UUID." })),
      labelIds: Type.Optional(Type.Array(Type.String(), { description: "Issue label UUIDs." })),
      estimate: Type.Optional(Type.Number({ description: "Team estimate value." })),
      dueDate: Type.Optional(Type.String({ description: "YYYY-MM-DD due date." })),
    }),
    async execute(_toolCallId, params, signal) {
      const teamId = await resolveTeamId(params.teamId, params.teamKey, signal);
      const input: JsonObject = { teamId, title: params.title };
      for (const key of ["description", "priority", "stateId", "assigneeId", "projectId", "labelIds", "estimate", "dueDate"] as const) {
        if (params[key] !== undefined) input[key] = params[key];
      }

      const data = await linearGraphql(
        `mutation IssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { ${issueFields} }
          }
        }`,
        { input },
        signal,
      );
      return toolResult(data, { input });
    },
  });

  pi.registerTool({
    name: "linear_update_issue",
    label: "Linear Update Issue",
    description: "Update common Linear issue fields such as title, description, priority, state, assignee, project, labels, estimate, and due date.",
    promptSnippet: "Update a Linear issue by id/identifier with common mutable fields.",
    promptGuidelines: [
      "Ask for confirmation before bulk Linear updates or when the requested change is ambiguous.",
      "Use linear_teams or linear_get_issue to discover valid stateId, assigneeId, projectId, and labelIds when needed.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Issue UUID or identifier, e.g. ENG-123." }),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      priority: Type.Optional(Type.Number({ description: "Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low." })),
      stateId: Type.Optional(Type.String({ description: "Workflow state UUID." })),
      assigneeId: Type.Optional(Type.String({ description: "Assignee user UUID. Use null via raw GraphQL to clear." })),
      projectId: Type.Optional(Type.String({ description: "Project UUID. Use null via raw GraphQL to clear." })),
      labelIds: Type.Optional(Type.Array(Type.String(), { description: "Replacement issue label UUIDs." })),
      estimate: Type.Optional(Type.Number()),
      dueDate: Type.Optional(Type.String({ description: "YYYY-MM-DD due date." })),
    }),
    async execute(_toolCallId, params, signal) {
      const { id, ...rest } = params;
      const input = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
      if (Object.keys(input).length === 0) throw new Error("No update fields provided.");

      const data = await linearGraphql(
        `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { ${issueFields} }
          }
        }`,
        { id, input },
        signal,
      );
      return toolResult(data, { input });
    },
  });

  pi.registerTool({
    name: "linear_add_comment",
    label: "Linear Add Comment",
    description: "Add a markdown comment to a Linear issue.",
    promptSnippet: "Add a markdown comment to a Linear issue by id/identifier.",
    parameters: Type.Object({
      issueId: Type.String({ description: "Issue UUID or identifier, e.g. ENG-123." }),
      body: Type.String({ description: "Markdown comment body." }),
    }),
    async execute(_toolCallId, { issueId, body }, signal) {
      const data = await linearGraphql(
        `mutation CommentCreate($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment { id body createdAt url user { id name email } issue { id identifier title url } }
          }
        }`,
        { input: { issueId, body } },
        signal,
      );
      return toolResult(data);
    },
  });

  pi.registerTool({
    name: "linear_graphql",
    label: "Linear GraphQL",
    description: "Run a raw Linear GraphQL query or mutation. Use for advanced Linear reads/writes not covered by the dedicated tools.",
    promptSnippet: "Run raw Linear GraphQL for advanced queries/mutations not covered by dedicated Linear tools.",
    promptGuidelines: [
      "Prefer dedicated Linear tools for common issue/team tasks; use linear_graphql for advanced schema-specific operations.",
      "For Linear collection orderBy arguments, only use PaginationOrderBy values createdAt or updatedAt. Do not use orderBy: priority/status/dueDate.",
      "For issue priority/due-date/title sorting, use the issues sort argument, e.g. sort: [{ priority: { order: Descending, noPriorityFirst: false } }]. PaginationSortOrder is case-sensitive: Ascending or Descending.",
      "For raw mutations, explain the intended change and ask for confirmation when user intent is unclear.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "GraphQL query or mutation." }),
      variables: Type.Optional(Type.Any({ description: "GraphQL variables JSON object." })),
    }),
    async execute(_toolCallId, { query, variables = {} }, signal) {
      const data = await linearGraphql(query, variables, signal);
      return toolResult(data, { variables });
    },
  });
}
