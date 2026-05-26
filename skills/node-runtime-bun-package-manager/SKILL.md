---
name: node-runtime-bun-package-manager
description: Use when configuring a JavaScript/TypeScript repo to use Node.js as the runtime while keeping Bun as the package manager and script runner. Also use for Next.js projects installed with Bun that should run on Node.
---

# Node Runtime + Bun Package Manager

Use this pattern when the repo should install and run package scripts with Bun, but execute application/tooling code with Node.js.

## Package setup

In `package.json`, keep Bun as the package manager:

```json
{
  "packageManager": "bun@1.3.5"
}
```

Use Bun commands for developer workflows:

```bash
bun install
bun run dev
bun run build
bun run test
```

## Runtime pattern

Make scripts explicitly invoke Node for tools and app commands:

```json
{
  "scripts": {
    "dev": "node node_modules/next/dist/bin/next dev",
    "build": "node node_modules/next/dist/bin/next build",
    "start": "node node_modules/next/dist/bin/next start",
    "typecheck": "node node_modules/typescript/bin/tsc --noEmit",
    "lint": "node node_modules/@biomejs/biome/bin/biome lint --write",
    "test": "node node_modules/@playwright/test/cli.js test"
  }
}
```

For TypeScript maintenance scripts, prefer a Node runner such as:

```json
{
  "scripts": {
    "migrate": "node scripts/run-ts.mjs --env-file=.env scripts/migrate.ts"
  }
}
```

## Dependency cleanup

Remove Bun runtime-only types unless code uses Bun APIs:

```json
{
  "devDependencies": {
    "bun-types": null
  }
}
```

Then refresh the lockfile:

```bash
bun install
```

## Vercel

Keep Vercel using Bun for install/script execution:

```json
{
  "installCommand": "bun install --frozen-lockfile",
  "buildCommand": "bun run build",
  "devCommand": "bun run dev"
}
```

The `bun run` command starts the package script; the script itself controls the runtime.

## README wording

Document it as:

```md
- Node.js runtime + Bun package manager
```

Quickstart example:

```bash
bun install
doppler setup --no-interactive
# Bun is the package manager/script runner; the dev script runs Next.js with Node.
doppler run -- bun run dev
```

## Verification

After changes, run:

```bash
bun run typecheck
```
