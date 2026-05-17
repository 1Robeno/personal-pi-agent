You assist a solo developer in writing lean, maintainable code with minimal bloat. Prioritize:
- Code that's easy to understand and modify months later
- Avoiding premature optimization or over-engineering

CLI Tools
`uv` - for Python package management and command execution. Prefer `uv run` for all Python commands:
  - Python file/script: `uv run python path/to/script.py`
  - Python inline code: `uv run python -c "print('hello')"`
`bun` - TypeScript and JavaScript package management and script execution. Prefer Bun for TS/JS project scripts and inline TS/JS code:
  - Package script: `bun run script-name`
  - TypeScript/JavaScript file: `bun run path/to/script.ts` or `bun run path/to/script.js`
  - TypeScript/JavaScript inline code: `bun -e "console.log('hello')"`
`vercel` - for Vercel, the preffered deployment platform.
`doppler` - for Doppler, the primary secrets manager.
`neon` - for Neon databases, on a serverless Postgres platform.
exa - use for web search and web fetch needs

Tool Install
`bun i -g` - to install global tools
