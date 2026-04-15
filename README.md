# uos-org-learning-plugin

Organizational learning plugin for Paperclip — captures, indexes, and surfaces learnings across the UOS Paperclip ecosystem.

## What it does

- Ingests learnings from incidents, projects, departments, and connectors
- Provides a searchable learning corpus with tagging and categorization
- Surfaces relevant learnings at decision and review points
- Maintains a learning health dashboard

## Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Type-check
npm run plugin:typecheck

# Build
npm run plugin:build

# Run tests
npm run plugin:test

# Watch mode (worker + ui)
npm run plugin:dev
```

## SurrealDB Cloud (production persistence)

The plugin uses SurrealDB Cloud for durable persistence. Without env vars it runs in **in-memory mode** — data is lost on restart (fine for dev/CI).

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### Required env vars

| Variable | Value |
|---|---|
| `SURREALDB_URL` | `wss://<instance>-xxxxxxxxxxxx.aws-euw1.surrealdb.cloud` |
| `SURREALDB_USER` | `root` (default) |
| `SURREALDB_PASS` | Your SurrealDB Cloud password |
| `SURREALDB_NS` | Namespace (e.g. `demo`) |
| `SURREALDB_DB` | Database (e.g. `surreal_deal_store`) |

For Paperclip platform deployment, set these in the plugin's environment configuration in the Paperclip dashboard.

## Architecture

- `src/manifest.ts` — Plugin manifest (capabilities, UI slots, entrypoints)
- `src/types.ts` — Core entity interfaces (Learnings, Sources, Tags)
- `src/constants.ts` — Plugin ID, DATA_KEYS, ACTION_KEYS, TOOL_KEYS
- `src/helpers.ts` — Data access layer (in-memory store + query helpers)
- `src/worker.ts` — Handler registration (data queries, actions, tools)
- `src/ui/index.tsx` — React UI widgets (dashboard, learning feed)
