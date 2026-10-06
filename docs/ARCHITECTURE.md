# Universal AI Core — architecture and boundary

```
                    Universal AI Core  (this repo)
                           |
          ┌────────────────┼────────────────┐
     LMS K12 adapter    G2G adapter     Future app adapter
          |                |                |
     LMS K12 data       G2G data        Future app data
```

The core is application-agnostic. It never names a table, a model class or a
session store. It calls the `AppAdapter` interface (`getContext`, `resolveEntity`,
`listCapabilities`, `getPermissions`, `getData`, `executeAction`) and the
`ChatEngine` interface. Each application implements those against its own data.

## What is shared (lives here)

| Area | Status |
|---|---|
| Adapter, ChatEngine, response contracts, isolation guard | done (`darshana-ai-core`) |
| Agent data-model types (byte-identical in both apps today) | done |
| Contract + isolation test suites | done (`darshana-ai-core/testing`) |
| Common AI types, model config/resolution client, policy client, usage/audit contracts | planned |
| Shared clients/hooks, navigation/action contracts | planned |
| Chat UI, AI Stack UI, AI & Intelligence UI | planned (after adapters exist) |
| Laravel package: config/model resolution, usage metering, audit, policy | planned |

## What stays LMS K12-specific (behind its adapter)
School ontology and lifecycle pipeline, `/ask/stream` SSE chatbot engine, cases,
signals, fees, outcomes, JWT/`McpRequestContext` auth, `X-MCP-Institute-Id`,
`sub_institute_id` multi-institute scoping, the four forked module stacks
(admissions, attendance, fees, student).

## What stays G2G-specific (behind its adapter)
The in-process `lib/ai` chat engine, `lib/mcp` server, `ModuleDataSourceCatalog`,
`hpbrain_*` / `agentic_*` reads, Sanctum/`AiRequestScope` auth, `platform_owners`,
`X-AI-Institute-Id`, the centralized per-module stack specs (`lib/ai-stack/central.ts`).

## How the boundary prevents data mixing

1. **Only adapters touch data.** The core has no database access; a source is
   a name the adapter advertised, never a table.
2. **Every value is stamped.** `AppContext`, `PermissionSet`, `DataResult`,
   `ActionResult`, `EntityRef`, `ChatReply` and `ConversationSummary` carry `appId`;
   data and permissions also carry `tenantId`.
3. **The guard enforces the stamps.** `guardAdapter` / `guardChatEngine` throw
   `CrossAppAccessError` when an input or output belongs to another app or
   another tenant. Violations are errors, never silently filtered.
4. **Routing is by `appId` only.** `AdapterRegistry` holds one adapter per app
   and refuses an unregistered app or a duplicate registration.
5. **Contract tests prove it per app.** `runAdapterContract` and
   `runChatEngineContract` run against the guarded implementation; an app
   cannot be released against the core until they pass.

## Chatbot: one interface, two engines
LMS keeps its SSE lifecycle pipeline and G2G keeps its in-process grounded
engine. Both implement `ChatEngine`; neither is rewritten. The shared chat UI
depends only on that interface.

## Migration rules
- No big-bang. Each piece moves behind a feature flag with the old code kept
  until the new path is verified; rollback is a flag flip.
- An application consumes a **pinned version** and upgrades only after its own
  tests and the contract suites pass.
- The existing implementation is never deleted in the same change that
  introduces its replacement.
- Apps are not wired to this repo until it is hosted somewhere their CI/deploy
  can reach (a path outside the app's own repo would break Vercel builds).

## Adding a new application
1. Implement `AppAdapter` (and a `ChatEngine`, or reuse an existing engine).
2. Call `runAdapterContract` / `runChatEngineContract` from the app's tests.
3. Register both in an `AdapterRegistry`. No core code changes.
