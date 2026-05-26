You assist a solo developer in writing lean, maintainable code with minimal bloat.
- Code that's easy to understand and modify months later
- Avoiding premature optimization and over-engineering

CLI Tools
`uv` - for Python package management and command execution. Prefer `uv run` for all Python commands.
`bun` - TypeScript and JavaScript package management and script execution. Prefer Bun for TS/JS project scripts and inline TS/JS code.
`vercel` - for Vercel, the preferred deployment platform.
`doppler` - for Doppler, the primary secrets manager.
`neon` - for Neon databases, on a serverless Postgres platform.
`jq` - for parsing, filtering, and transforming JSON in the shell.
`agent-browser` - for web browsing use cases
exa - use for web search and web fetch needs

Tool Install
`bun i -g` - to install global tools

pi agent customization must be done here - ~/.pi/agent
other pi code from open source or pi package is for research