---
name: cursor-agent-orchestration
description: Use when the user wants Pi to orchestrate Cursor Agent CLI workers for Linear issues, code tasks, implementation labour, or verification, especially when they ask to dispatch Cursor agents, use the explorer extension's Cursor invocation pattern, or run Cursor with composer-2.5.
---

# Cursor Agent Orchestration

## Goal

Use Pi as the orchestrator and verifier while Cursor Agent performs the implementation labour. Prefer this when the user asks to dispatch Cursor agents for Linear issues or multi-step repo work.

## Cursor Agent Invocation

Use Cursor Agent in non-interactive print mode with the requested model:

```bash
powershell.exe -NoProfile -Command '$p = Get-Content -Raw ".scratch/cursor-prompts/TASK.md"; & "$env:USERPROFILE\AppData\Local\cursor-agent\cursor-agent.cmd" -p --trust --force --model composer-2.5 --workspace (Get-Location).Path --output-format json $p'
```

If `composer-2.5` is unavailable, run:

```bash
"$HOME/AppData/Local/cursor-agent/cursor-agent.cmd" --list-models
```

Then use the nearest Composer 2.5 model shown by the CLI and mention the substitution.

## Orchestration Process

1. Read the Linear issue(s) and project rules before dispatch.
2. Move each Linear issue to `In Progress` before work starts.
3. Decide safe ordering:
   - Run non-overlapping docs, tests, and isolated modules in parallel only when file scopes do not collide.
   - Run shared-contract or broad ETL tasks sequentially.
4. Create prompt files under `.scratch/cursor-prompts/` to avoid shell quoting problems.
5. Give Cursor a bounded worker prompt:
   - issue id and title
   - goal, scope, acceptance criteria
   - exact files to prefer or avoid
   - verification commands
   - “Do not update Linear. Do not commit.”
6. Capture JSON output under `.scratch/cursor-results/` when useful.
7. Review Cursor’s changes yourself with `git diff`, targeted reads, and searches.
8. Run independent verification from Pi, not only Cursor’s reported verification.
9. Move issues to `Verification`, run final checks, then move to `Done` only after success.
10. Add concise Linear comments summarizing implementation and verification.
11. Remove temporary `.scratch/cursor-prompts/` and `.scratch/cursor-results/` unless the user asks to keep logs.

## Worker Prompt Skeleton

```text
You are Cursor Agent running as an implementation worker for Linear issue ISSUE-ID in this repository.

Goal:
...

Scope:
- ...

Acceptance criteria:
- ...

Constraints:
- Keep changes lean and maintainable.
- Preserve existing behavior unless the issue explicitly requires a behavior change.
- Do not update Linear.
- Do not commit.

Verification expected from you:
- uv run python -m pyright
- uv run python -m pytest -q ...

Return a concise summary of files changed and verification results.
```

## Verification Standards

Always verify independently after Cursor finishes:

```bash
git diff --check
uv run python -m pyright
uv run python -m pytest -q tests/unit
```

Use narrower issue-specific tests first when helpful, then run the broader final gate when practical.

## Linear Discipline

Follow this workflow:

1. `In Progress` before dispatch.
2. `Verification` after implementation appears complete.
3. Run Pi-side verification.
4. `Done` only after verification passes.

For failed verification, keep the issue in `Verification` or move it back to `In Progress`, then dispatch a follow-up Cursor prompt with the exact failure output.
