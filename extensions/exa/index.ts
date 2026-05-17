import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const userHome = process.env.USERPROFILE ?? process.env.HOME;
const globalRequire = createRequire(join(userHome, ".bun", "install", "global", "node_modules"));
const { Type } = globalRequire("typebox");
const Exa = globalRequire("exa-js").default;

function getExaApiKey() {
  if (process.env.EXA_API_KEY) return process.env.EXA_API_KEY;

  // pi may be started from a process that did not source ~/.bashrc.
  // Read a simple `export EXA_API_KEY=...` or `EXA_API_KEY=...` line directly.
  for (const file of [".bashrc", ".bash_profile", ".profile"]) {
    try {
      const text = readFileSync(join(userHome, file), "utf8");
      const match = text.match(/^\s*(?:export\s+)?EXA_API_KEY\s*=\s*(['"]?)([^'"\r\n#]+)\1/m);
      if (match?.[2]) {
        process.env.EXA_API_KEY = match[2].trim();
        return process.env.EXA_API_KEY;
      }
    } catch {}
  }

  throw new Error("EXA_API_KEY is not set. Export it before starting pi, or add `export EXA_API_KEY=...` to ~/.bashrc.");
}

export default function (pi) {
  const exa = new Exa(getExaApiKey());

  // --- Tool 1: Web search with highlights ---
  pi.registerTool({
    name: "exa_search",
    description: "Search the web using Exa. Returns highlighted, token-efficient excerpts relevant to the query.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numResults: Type.Optional(Type.Number({ description: "Number of results (default 3)" })),
      type: Type.Optional(Type.Union([
        Type.Literal("auto"),
        Type.Literal("fast"),
        Type.Literal("deep"),
      ], { description: "Search type. Default: auto" })),
    }),
    async execute(_toolCallId, { query, numResults = 3, type = "auto" }) {
      const result = await exa.search(query, {
        numResults,
        type,
        contents: {
          highlights: { maxCharacters: 2000 },
        },
      });

      const formatted = result.results.map((r) =>
        `## ${r.title}\n${r.url}\n\n${r.highlights?.join("\n\n") ?? "(no highlights)"}`
      ).join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: formatted }],
      };
    },
  });

  // --- Tool 2: Code-focused search with the exa-code prompt trigger ---
  pi.registerTool({
    name: "exa_code",
    description: "Search for coding details, API usage, SDK examples, and documentation using Exa's code-focused exa-code behavior. Always prefixes queries with `use exa-code:`.",
    parameters: Type.Object({
      query: Type.String({ description: "Coding/API/SDK/library question or search query" }),
      numResults: Type.Optional(Type.Number({ description: "Number of results (default 3)" })),
      type: Type.Optional(Type.Union([
        Type.Literal("auto"),
        Type.Literal("fast"),
        Type.Literal("deep"),
      ], { description: "Search type. Default: auto" })),
    }),
    async execute(_toolCallId, { query, numResults = 3, type = "auto" }) {
      const trimmed = query.trim();
      const codeQuery = /^use\s+exa-code\s*:/i.test(trimmed)
        ? trimmed
        : `use exa-code: ${trimmed}`;

      const result = await exa.search(codeQuery, {
        numResults,
        type,
        contents: {
          highlights: { query: codeQuery, maxCharacters: 3000 },
        },
      });

      const formatted = result.results.map((r) =>
        `## ${r.title}\n${r.url}\n\n${r.highlights?.join("\n\n") ?? "(no highlights)"}`
      ).join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: formatted }],
        details: { query: codeQuery },
      };
    },
  });

  // --- Tool 3: Fetch and read a URL ---
  pi.registerTool({
    name: "exa_fetch",
    description: "Fetch and read the full content of a URL as clean text.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
    }),
    async execute(_toolCallId, { url }) {
      const { results } = await exa.getContents([url], { text: true });
      const page = results[0];

      return {
        content: [{
          type: "text",
          text: `## ${page.title}\n${page.url}\n\n${page.text ?? "(no content)"}`,
        }],
      };
    },
  });

  // --- Tool 4: Find similar pages ---
  pi.registerTool({
    name: "exa_similar",
    description: "Find pages similar to a given URL. Good for finding related docs, articles, or alternatives.",
    parameters: Type.Object({
      url: Type.String({ description: "Reference URL" }),
      numResults: Type.Optional(Type.Number({ description: "Number of results (default 3)" })),
    }),
    async execute(_toolCallId, { url, numResults = 3 }) {
      const result = await exa.findSimilar(url, {
        numResults,
        excludeSourceDomain: true,
        contents: { highlights: { maxCharacters: 1000 } },
      });

      const formatted = result.results.map((r) =>
        `## ${r.title}\n${r.url}\n\n${r.highlights?.join("\n") ?? ""}`
      ).join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: formatted }],
      };
    },
  });
}
