# Linear Pi extension

Direct Linear GraphQL integration for Pi. This is intentionally **not** MCP: Pi does not have native MCP support, and a focused GraphQL extension is smaller, faster, and enough for day-to-day issue/project work.

## Auth

Create a Linear personal API key:

1. Linear → Settings → Account → Security & access → Personal API keys
2. Create a key with the least permissions you need (`read`, plus `write`/`issues:create`/`comments:create` if you want mutations)
3. Export it before starting Pi:

```sh
export LINEAR_API_KEY=lin_api_...
pi
```

The extension also accepts `LINEAR_API_TOKEN`, `LINEAR_ACCESS_TOKEN` / `LINEAR_OAUTH_TOKEN` (sent as `Bearer ...`), or `LINEAR_AUTH_HEADER` for a fully custom Authorization header.

After adding/changing credentials, restart Pi or run `/reload`, then run:

```text
/linear-auth
```

## Tools

- `linear_viewer` — check auth and return the current user
- `linear_teams` — list teams and workflow states
- `linear_search_issues` — free-text issue search
- `linear_list_issues` — issues with common filters and safe sorting (`sortBy: "priority"` instead of invalid raw `orderBy: priority`)
- `linear_get_issue` — issue details by UUID or identifier (`ENG-123`)
- `linear_create_issue` — create an issue using `teamId` or `teamKey`
- `linear_update_issue` — update common fields
- `linear_add_comment` — add markdown comments
- `linear_graphql` — raw GraphQL escape hatch

## GraphQL sorting note

Linear collection `orderBy` uses the `PaginationOrderBy` enum, which only accepts `createdAt` or `updatedAt`. For issue priority/due-date/title sorting, use the `issues(sort: ...)` argument instead, e.g.:

```graphql
issues(first: 20, sort: [{ priority: { order: Descending, noPriorityFirst: false } }]) {
  nodes { identifier title priority }
}
```

## Why this path

Linear's official MCP endpoint is `https://mcp.linear.app/mcp` and is the right choice for clients with native MCP. In Pi, adding a generic MCP client would mean implementing stdio/HTTP transports, tool schema adaptation, OAuth persistence, and security UX. For Linear specifically, the GraphQL API already exposes the same core operations with simple API-key auth, so this extension is the leaner path.
