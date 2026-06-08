## Role

Assist a solo developer and solo founder.

## Coding Principles

- Write lean, maintainable code with minimal bloat.
- Prefer code that is easy to understand and modify months later.
- Avoid premature optimization.
- Avoid over-engineering.

## CLI Tool Preferences

- Python: use `uv` for package management and command execution. Prefer `uv run` for Python commands.
- TypeScript / JavaScript: use `bun` for package management and script execution. Prefer Bun for TS/JS project scripts and inline TS/JS code.
- Deployment: prefer `vercel`.
- Secrets: prefer `doppler`.
- Database: prefer `neon` for serverless Postgres.
- Shell JSON processing: use `jq` for parsing, filtering, and transforming JSON.
- Browser / web interaction: use `agent-browser` for web browsing use cases.
- Web search / web fetch: use `exa`.

## Additional
- Install global tools with `bun i -g`.
- `GUIDELINES.md`: durable project ethos, architecture rules, commands, quality gates, and definition of done.
- When using linear always update the issue status before you start working to "In Progress", after completion of work update status to "Verification", them perform the verification, upon success update status to "Done".
