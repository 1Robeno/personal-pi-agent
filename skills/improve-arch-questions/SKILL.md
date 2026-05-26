---
name: improve-arch-questions
description: Review a codebase for maintainability problems using locality, shallow-module, coupling, and testability questions. Use when asked to find areas to improve, simplify architecture, reduce indirection, or audit codebase structure.
disable-model-invocation: true
---

# Improve Architecture Questions

Use this skill to review a codebase and identify areas where the structure makes code harder to understand, change, or test.

Ask these questions while inspecting the code:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules shallow — their interface is nearly as complex as their implementation?
- Where have pure functions been extracted mainly for testability, while the real bugs hide in how they are called or orchestrated?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Report findings as concise, actionable notes:

- Location
- Concern
- Why it matters
- Suggested simplification
