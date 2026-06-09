---
name: simplify-overengineering
description: Review code, designs, patches, or implementation plans for avoidable complexity and replace custom wrappers, duplicated behavior, defensive scaffolding, broad abstractions, or compatibility shims with the simplest correct path. Use when the user asks to find over-engineering, reduce bloat, simplify a solution, compare an old and new implementation, review why a change became too complex, or identify where native platform behavior should replace hand-rolled logic.
---

# Simplify Overengineering

## Goal

Find places where code solves a problem that the surrounding system, runtime, framework, library, or operating environment already solves. Prefer the leanest implementation that preserves behavior, debuggability, and clear failure modes.

## Review Process

1. Identify the real contract: what behavior must exist, what inputs are allowed, what environment is guaranteed, and what failure should look like.
2. Read the nearby code and configuration before judging. Look for existing startup hooks, package managers, framework conventions, path helpers, lifecycle methods, dependency injection, test fixtures, or shell/runtime behavior already available.
3. Mark complexity as suspicious when it:
   - Reimplements native or framework behavior.
   - Parses or rewrites another source file to avoid fixing execution setup.
   - Loads dependencies manually that the package manager or script already declares.
   - Adds wrappers, adapters, registries, factories, or bootstraps without a real extension point.
   - Silently ignores missing dependencies or errors that should fail fast.
   - Creates temporary files, string filters, broad globals, or regex transformations for a simple execution path.
   - Preserves compatibility with a hypothetical case not present in the codebase.
4. Propose the lean path first. Explain which existing mechanism makes it possible.
5. Remove the bloat only after confirming the simple path matches the contract. Update tests to lock in the simpler contract, not the old implementation details.

## Output Style

When reporting findings, be direct and concrete:

- State the over-engineered behavior.
- State the simpler native/codebase-supported behavior.
- List what can be removed.
- Explain why the result is better: fewer moving parts, clearer errors, less hidden state, easier debugging, or stronger alignment with existing conventions.

Avoid vague advice such as "make it cleaner." Name the exact code and the exact replacement.
