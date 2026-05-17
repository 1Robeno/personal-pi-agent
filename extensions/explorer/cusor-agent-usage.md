# Cursor Agent CLI Usage Notes

These are practical notes from looking up Cursor Agent CLI docs and testing the installed local CLI.

## Local executable

On this machine, `agent` was not available on the shell `PATH`, but Cursor Agent is installed at:

```bash
C:/Users/R0B/AppData/Local/cursor-agent/cursor-agent.cmd
```

From Git Bash / bash, it can be invoked directly with:

```bash
"$HOME/AppData/Local/cursor-agent/cursor-agent.cmd" --help
```

To make the shorter `agent ...` form work, add this directory to PATH:

```text
C:\Users\R0B\AppData\Local\cursor-agent
```

## Non-interactive / print mode

Use `-p` or `--print` to run Cursor Agent in non-interactive mode:

```bash
agent -p "your prompt"
```

or, using the full local path:

```bash
"$HOME/AppData/Local/cursor-agent/cursor-agent.cmd" -p "your prompt"
```

Print mode is meant for scripts, automation, CI, and other headless usage. It prints the response to stdout.

Important: Cursor Agent can still access tools in print mode. The docs state that `--print` has access to all tools, including write and shell. For actual file modifications in scripts, combine print mode with `--force` / `--yolo` when appropriate.

## Workspace trust

When tested in `C:\Users\R0B\.pi`, Cursor Agent refused to run headlessly until the workspace was trusted:

```text
Workspace Trust Required
Cursor Agent can execute code and access files in this directory.
```

For trusted local workspaces in headless mode, pass:

```bash
--trust
```

Example:

```bash
agent -p --trust "Analyze this repo"
```

`--trust` only works with print/headless mode.

## Selecting Composer 2 Fast

The exact model id for Composer 2 Fast is:

```text
composer-2-fast
```

Use it with `--model`:

```bash
agent -p --trust --model composer-2-fast "your prompt"
```

A local `models` command confirmed:

```text
composer-2-fast - Composer 2 Fast (default)
composer-2 - Composer 2 (current)
```

A stream JSON test also confirmed the selected model appears as:

```json
"model":"Composer 2 Fast"
```

## Useful command flags

Common flags from `agent --help` / Cursor docs:

| Flag | Purpose |
| --- | --- |
| `-p`, `--print` | Non-interactive mode; print response to stdout. |
| `--trust` | Trust current workspace in headless mode. |
| `--model <model>` | Select model, e.g. `composer-2-fast`. |
| `--mode ask` | Ask / Q&A mode; read-only. |
| `--mode plan` | Plan mode; read-only planning. |
| `--plan` | Shorthand for `--mode plan`. |
| `--output-format text` | Plain final-response output. Default for `--print`. |
| `--output-format json` | Structured JSON result. |
| `--output-format stream-json` | Event stream JSON output. |
| `--stream-partial-output` | Stream individual text deltas; only with `--print` and `stream-json`. |
| `-f`, `--force` | Force allow commands unless explicitly denied. Useful for automation that edits files. |
| `--yolo` | Alias for `--force`. |
| `--sandbox enabled\|disabled` | Explicitly enable or disable sandbox mode. |
| `--workspace <path>` | Set workspace directory. Defaults to current directory. |
| `--resume [chatId]` | Resume a session. |
| `--continue` | Continue previous session. Alias for latest resume behavior. |
| `--list-models` | List available models and exit. |
| `-H`, `--header <header>` | Add custom header to agent requests, e.g. `-H "Name: Value"`. Can be repeated. |
| `--api-key <key>` | API key auth. Can also use `CURSOR_API_KEY`. |
| `--plugin-dir <path>` | Load a local plugin directory. Can be repeated. |
| `--worktree [name]` | Run in an isolated git worktree under `~/.cursor/worktrees`. |

## Output formats

### Text

Default for `-p`:

```bash
agent -p --trust --model composer-2-fast "Summarize this project"
```

### JSON

Good for scripts:

```bash
agent -p --trust --model composer-2-fast --output-format json \
  "Reply with exactly: cursor-agent-ok"
```

Observed successful result shape:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 6031,
  "duration_api_ms": 6031,
  "result": "cursor-agent-ok",
  "session_id": "ad16714e-44be-4490-b0b2-00c1c72dd236",
  "request_id": "66ca5091-c864-4c49-93f5-98570e26ae3b",
  "usage": {
    "inputTokens": 15644,
    "outputTokens": 34,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0
  }
}
```

### Stream JSON

Good for progress tracking and confirming model selection:

```bash
agent -p --trust --model composer-2-fast --mode ask \
  --output-format stream-json \
  "Say only: ok"
```

Observed output included:

```json
{"type":"system","subtype":"init","model":"Composer 2 Fast","permissionMode":"default"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}
{"type":"result","subtype":"success","result":"ok"}
```

For incremental text deltas, add:

```bash
--stream-partial-output
```

## Safe read-only examples

Ask mode, JSON output:

```bash
agent -p --trust --model composer-2-fast --mode ask --output-format json \
  "What does this codebase do? Do not edit files."
```

Plan mode:

```bash
agent -p --trust --model composer-2-fast --plan \
  "Plan how to refactor the auth module. Do not edit files."
```

## File-changing automation examples

Only use these in trusted workspaces where direct edits are intended.

```bash
agent -p --trust --force --model composer-2-fast \
  "Add JSDoc comments to src/app.ts"
```

`--yolo` is equivalent to `--force`:

```bash
agent -p --trust --yolo --model composer-2-fast \
  "Run tests, fix failures, and summarize changes"
```

## Tested commands

Initial test without trust failed:

```bash
"$HOME/AppData/Local/cursor-agent/cursor-agent.cmd" \
  -p --model composer-2-fast --mode ask --output-format json \
  "Reply with exactly: cursor-agent-ok"
```

Successful trusted JSON test:

```bash
"$HOME/AppData/Local/cursor-agent/cursor-agent.cmd" \
  -p --trust --model composer-2-fast --mode ask --output-format json \
  "Reply with exactly: cursor-agent-ok"
```

Result:

```json
{"result":"cursor-agent-ok"}
```

Successful trusted stream JSON test confirming Composer 2 Fast:

```bash
"$HOME/AppData/Local/cursor-agent/cursor-agent.cmd" \
  -p --trust --model composer-2-fast --mode ask \
  --output-format stream-json \
  "Say only: ok"
```

Observed model:

```json
"model":"Composer 2 Fast"
```

## Notes from Cursor docs

- `agent -p` / `agent --print` is the supported non-interactive mode.
- `--output-format` only applies with `--print`.
- Available output formats: `text`, `json`, `stream-json`.
- Cursor Agent reads project rules similarly to the editor, including `.cursor/rules`, `AGENTS.md`, and `CLAUDE.md` where present.
- Cursor Agent supports MCP servers configured for Cursor.
- For scripts requiring authentication, use either an existing login or `CURSOR_API_KEY` / `--api-key`.
- Composer 2 Fast is the default fast Composer variant and is tuned for Cursor agentic tool use, file edits, and terminal operations.
