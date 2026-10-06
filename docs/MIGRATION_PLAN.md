# Migration plan — LMS K12 as the reference implementation

LMS K12 (`lms_k12` frontend, `next_lms_erp` backend) is the reference. The common parts
are extracted from it into this repo; each application, LMS K12 and G2G included, plugs in
through an adapter and keeps its own database, auth, tenancy, modules and permissions.
Nothing is rewritten in one go: every step is additive, flag-gated where it changes behaviour,
and must leave both applications' test baselines green before the next step starts.

## Gates (apply to every step)

| Gate | LMS K12 | G2G |
|---|---|---|
| Frontend tests | `npm test` = **591/591** (confirmed before this plan) | `npm test` = **45/45** |
| Typecheck | no new `tsc` errors | 5 existing errors, no new ones |
| Build | `next build` | `next build`, flag on **and** off |
| Core | `npm test` here, including the purity guard | — |
| Backend | PHPUnit: see "Known risk" below | `GeminiCredentialFailoverTest` + new package tests |

A step that regresses a gate is reverted, not patched forward.

## Environment isolation (local vs live)

The core has no URL, env var, hostname, storage key, table, tenant column or module id.
`src/purity.test.ts` fails the build if one appears. Everything environmental reaches the
core through ports (`AiTransportPort.apiBase/session/headers`, and on the backend a
`ScopeResolver` + table/connection config owned by the host). So the same core build runs
against LMS local, LMS live, G2G local and G2G live; each app's adapter decides which
database and API "now" means from its own authenticated environment. A package never
opens its own database connection and never ships migrations that run by themselves.

## What is shared / adapter-owned

| Shared (core) | Adapter-owned (per app) |
|---|---|
| AI Stack screens (9 tabs), AI & Intelligence console, chat panel and answer rendering | Module descriptors, tool catalogues, executors |
| `AppAdapter`, `ChatEngine`, rich answer/stream vocabulary, isolation guard | The chat engine itself and its lifecycle |
| AI HTTP client, envelope, error handling | Session reading, API base resolution (local/live), headers |
| Backend: provider clients, configuration, model bindings, policy and template resolution, audit, usage contracts | Auth/scope (`JWT` / `Sanctum`), tenant column and table names, module catalogue, data sources, `ai_conversations*`, branding, sample data |

LMS-only and staying in LMS: the 12-stage lifecycle backend (`LifecyclePipeline` and stages),
the school ontology/fees/admissions/attendance code, the four legacy forked module stacks until
retired, `ChatbotPanel`'s school wording. G2G keeps its own chat engine behind `ChatEngine`.

## Steps

**Step 0 — Safety net (no behaviour change).**
LMS: characterization tests for what has none today: session reader, `resolveAiBaseUrl` precedence,
header builders, agents client, the `ask/stream` wire contract (fixture). G2G: done (45/45).
Backend: standalone package tests; record the real PHPUnit baseline (see risk).

**Step 1 — Contracts (done in core v1.2.0).** Rich answer + stream vocabulary, `ChatHostPort`,
`AiTransportPort`, shared HTTP client, purity guard. Additive; contract version 1.1.0.

**Step 2 — Transport adoption, per app, behind a flag.**
LMS: an adapter implementing `AiTransportPort` over today's `resolveAiBaseUrl` / `userData` readers;
the eight duplicated session readers delegate to it; old paths remain until proven.
G2G: the same, over `resolveAiBaseUrl` / `readLaravelSession` (replaces `lib/intelligence/client.ts` internals).
Gate: each app's tests + a request-parity test (same URL, same headers as before).

**Step 3 — Pure universal frontend code.** `sse`, `followup-suggestions`, `PageAiContext`,
`LifecycleTrace`, `ai-intelligence-core` (solution list injected, not hardcoded), `lib/agents`
engine/store (`/server` entry, they use `node:fs`). LMS re-exports from the old paths (shims).

**Step 4 — AI Stack screens.** Add `AiStackModule`, module registry, tool catalogue and UI-slot ports;
move the 12 shared screens. LMS descriptors stay LMS data. Then retire the four legacy forks one at a
time (attendance first, fees last), each only after the shared screen shows parity. ~20k lines removed.
Module scoping is preserved: a module's AI Stack lists only that module's tools and data sources.
`/ai/*` and `/<module>/ai-stack` stay separate routes and separate navigation (`AiNavigationPort`).

**Step 5 — AI & Intelligence console (`/ai/*`).** Same pattern; remove the Fees chrome import and the
hardcoded currency/locale (`AiBranding`).

**Step 6 — Chat UI.** `lmsAskAdapter` maps `AskResult` to the rich `ChatReply`; a render
characterization test first, then extract `AnswerSections` and `ChatPanel` with `ChatHostPort`;
`ChatbotPanel` becomes a thin wrapper. The LMS engine, the Next `ask/stream` route and the Laravel
backend are untouched. G2G then implements its own `ChatEngine` and uses the same panel.

**Step 7 — Backend package (Composer, consumed by tag).** In order: pure value objects and catalogues,
provider clients, `TenantScope`/`AiTables`/`CredentialSource` ports (SQL verified identical),
configuration core, `AiScope`/`ScopeResolver` seam, audit and policy, templates, controllers/routes
(`route:list` diff). G2G's metering/quota/failover/evaluation become an optional feature of the
package; LMS adopts them only after its AI test suite is green on them. Additive normalisation:
`/templates/catalog` alias in G2G, `PUT /reports/{id}` in LMS, `/modules/{m}/data-sources` and
`features` on `/capabilities` in both.

**Step 8 — G2G fully on the core.** The G2G-specific forks of the AI Stack and chatbot UI are removed
once each shared replacement has run behind its flag.

## Known risk — backend baseline is not green

`next_lms_erp`'s PHPUnit suite boots the full app and, by default, the real database. Run in-memory
against sqlite, 19 pure-logic AI unit files gave 207 tests, 37 errors (a boot-time table lookup) and 2
failures that look like existing drift (`AiReportRefreshTest`, `IntentPrecisionTest`). The backend
gate is therefore "no new failures versus the recorded baseline", and recording that baseline against
a safe copy of the database is a prerequisite for Step 7. No backend step starts before then.

## Other risks

- The AI Stack screens, `ai-*` clients and `app/api` routes have no tests in LMS; Step 0 adds them first.
- `automations-screen` pulls ~750 lines from `app/enterprise-brain`; it needs slot ports before it moves.
- The screens assume the Laravel AI contract, so they are universal across apps that serve it; the
  normalisation in Step 7 is what makes G2G and LMS actually match.
- G2G builds with `ignoreBuildErrors: true`, so a type break in the core would not fail its build; the core
  is type-checked strictly in its own CI-equivalent (`npm run typecheck`) and each release is tag-pinned.
- Private-repo installs need a read token on every build machine (Vercel, LMS CI).
