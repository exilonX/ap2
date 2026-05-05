# PRD: YAML-driven Profiles + Industry Tool Bundles

- **Status:** needs-triage
- **Created:** 2026-05-04
- **GitHub:** _(filled when promoted)_

## Problem Statement

Today, onboarding a new merchant (a "Profile" in `CONTEXT.md` terms) means writing a TypeScript file under `node/config/profiles/`, registering it in `node/config/load.ts`, and shipping a build. The chat handler loads the same single tool set (`CHAT_TOOLS`) for every merchant regardless of vertical — so a fashion store and an electronics store get the same generic toolbox even though their shoppers ask radically different questions.

Two consequences:

1. **Profile changes are not zero-code.** That violates the architectural invariant that adapting per-merchant should be a Layer 1 (Profile) edit, not Layer 2 (Adapter) code. The current "platform, not template" pitch in `docs/SHOWCASE_PLAN.md` only lands when the second merchant proves it.
2. **The LLM gets a generic tool surface.** A fashion shopper asking for "an outfit for a wedding" gets four manual searches; an electronics shopper asking "how do these two laptops compare" gets long product-detail dumps the model has to diff itself. Tool descriptions also cost tokens on every chat call (`CONTEXT.md` invariant #9), so loading every vertical's tools for every merchant is also wasteful.

This blocks adding a second real merchant cleanly and blocks the case-study narrative ("our widget adapts to your vertical via config").

## Solution

Make Profiles real, schema-validated YAML files, and split the LLM tool surface into a small core plus an industry-specific bundle that's chosen at chat time based on the active Profile's `industry` field.

A new merchant becomes:

1. Write a YAML file with their brand, locales, starters, custom rules, industry, and (eventually) filters.
2. Drop it in `profiles/`.
3. The Adapter validates it on cold start, picks it for matching VTEX accounts, and the chat handler automatically loads the right industry bundle.

No TypeScript edits. No redeploy required beyond restarting the IO service.

The work is bounded to the **Personalization** sub-domain (the Profile system) and the **Discovery / Cart Negotiation** sub-domains' interface to the LLM (the tool list). It does not touch the AP2 core, the RAG pipeline, the widget UI, or the Surfaces (MCP / chat widget) other than transparently via `GET /_v/acg/config`.

## User Stories

1. As a **merchant**, I want my brand name, tone, and locale defaults to drive the assistant's voice, so the assistant feels like part of my store and not a generic widget.
2. As a **merchant**, I want my vertical (fashion / electronics / grocery / home / beauty) to determine which specialized tools the assistant has, so shoppers get vertical-appropriate help without me writing prompts.
3. As a **merchant**, I want to add custom rules (return-policy reminders, banned topics, brand-voice do/don't lists) to the assistant's behavior, so merchant-specific guardrails don't require an Adapter code change.
4. As a **merchant**, I want UI strings (greeting, placeholder, header title) per locale, so my assistant speaks Romanian on `.ro` and English on `.com`.
5. As a **merchant**, I want my brand accent color and starter chips reflected in the widget, so the Surface looks like mine.
6. As a **merchant**, I want my Profile's `confirmationStyle` and `multiStepFlow` to keep working in YAML the same way they work in the current TS profile, so existing behavior is preserved.
7. As an **operator onboarding a new merchant**, I want to add a YAML file under `profiles/` and have the new merchant work end-to-end, with zero TS code changes to the Adapter.
8. As an **operator**, I want a malformed Profile to fail fast on Adapter cold-start with an error pointing at the offending field, so I catch problems before any shopper sees them.
9. As an **operator**, I want the schema to be the single source of truth, with TS types derived from it, so the validator and the type definition can never silently drift.
10. As an **operator**, I want the system to fall back to a default Profile when no Profile matches the current VTEX account, so newly-linked workspaces don't break.
11. As an **operator**, I want a Profile change to take effect on the next cold start without redeploying the IO service, so iteration is fast in v1.
12. As a **developer extending a vertical**, I want to add a new tool to the fashion bundle without touching the chat handler, so the chat loop stays generic.
13. As a **developer adding a new vertical** (e.g. furniture), I want to create one bundle file and register it in one place, so I'm not editing chat-loop logic.
14. As a **developer**, I want only the active Profile's industry tools loaded into the LLM context per chat, so we don't pay for unused tool descriptions on every message (Engine invariant on cost).
15. As a **developer**, I want the system-prompt builder to be a pure function I can snapshot-test, so I can verify the prompt I expect gets built for a given Profile/locale.
16. As a **developer**, I want the Profile loader to be swappable (filesystem today, VBase tomorrow, admin UI eventually) without touching callers, so the storage backend can evolve without ripple.
17. As a **developer**, I want the schema to validate filter definitions as a discriminated union (chips / swatch / slider / enum_per_category / conditional), so the widget can rely on the shape it gets back from `GET /_v/acg/config`.
18. As a **shopper at a fashion merchant**, I want the assistant to offer to find me a complete outfit when I describe an occasion, so I don't have to search for each piece individually.
19. As a **shopper at an electronics merchant**, I want the assistant to compare two products on specs I care about, so I can decide between options without diffing spec sheets myself.
20. As a **shopper at a grocery merchant**, I want the assistant to suggest a recipe and add the missing ingredients to my cart, so I shop the meal plan rather than the SKUs.
21. As a **shopper**, I want my locale's greeting and starter chips when I open the widget, so I'm not greeted in a language I don't speak.
22. As a **shopper**, the assistant's tone should match the merchant's brand (casual on a fashion store, precise on a tech reseller), so I get communication that fits where I am.
23. As the **widget code**, I want to fetch the Profile's filter definitions so I can render the right UI components (color swatches, sliders, chips) per merchant — even if that registry ships in a later PRD.
24. As an **auditor**, I want to know which Profile was active for a given conversation, so I can reproduce behaviour post-hoc.
25. As **the LLM**, I want a small, vertical-relevant tool set rather than 50+ tools, so I make better tool choices and consume less context per turn.
26. As a **maintainer**, I want adding a new merchant to be a constant-time operation regardless of how many merchants already exist, so onboarding cost doesn't grow with scale.
27. As a **maintainer**, I want each industry bundle to be testable in isolation (assert the tool list returned for `industry: fashion`), so bundle composition stays mechanical and inspectable.
28. As a **maintainer**, I want the existing two profiles (`default`, `miniprix`) to port verbatim to YAML with no behavioural change, so this is a strict refactor + extension and not a behaviour migration.

## Implementation Decisions

### Modules

The work is split into deep modules with narrow surfaces. Modules live in the Adapter (`packages/vtex-io-adapter`); none of this lands in `@acg/core` or in the MCP server.

- **ProfileSchema** — a zod schema for `ClientConfig`. Discriminated unions for filter types. The TypeScript `ClientConfig` type is `z.infer`-ed from this schema; there is no separately-maintained interface. This module has no I/O and is pure data.

- **ProfileLoader** — a single function: `loadProfileForAccount(account: string) → ClientConfig`. Reads YAML files from a configured directory, parses them, validates against `ProfileSchema`, picks the one whose `accountMatches` includes the account (case-insensitive), falls back to a `default` profile, and caches the result in memory. The storage backend is encapsulated behind this signature so it can be swapped for VBase or an admin-UI store later without touching callers. Validation failures throw on cold start with a message identifying the offending file and field path.

- **SystemPromptBuilder** — a pure function: `buildSystemPrompt(profile: ClientConfig, locale: string) → string`. Composes brand tone, `llmContext`, `customRules`, and an industry-specific preamble (fashion/electronics/grocery/home/beauty/generic). Replaces the inline prompt construction currently in `chat.ts`.

- **ToolRegistry** — a pure function: `getToolsForProfile(profile: ClientConfig) → LLMTool[]`. Concatenates `CORE_TOOLS` with the industry bundle selected by `profile.industry`. Unknown or `generic` industries return `CORE_TOOLS` only.

- **Industry Tool Bundles** — one module per vertical. Each exports `{ industry: 'fashion', tools: LLMTool[] }`. The PRD wires the bundles in but defines tool *handlers* only as stubs returning a clear "not yet implemented" payload — real handler logic is per-bundle follow-up work outside this PRD's scope. Initial bundles: `fashion`, `electronics`, `grocery`, `home`, `beauty`. `generic` is the empty bundle.

- **Config Endpoint (modified)** — `GET /_v/acg/config` keeps its exact response shape but switches its source from `loadConfigForAccount` (which reads inline TS profiles) to `ProfileLoader`. No widget change required.

### Interfaces

- `ProfileLoader.loadProfileForAccount(account)` is the only place anything reads a Profile. `chat.ts`, `getConfig`, and any future Profile consumer go through it.
- `ToolRegistry.getToolsForProfile(profile)` and `SystemPromptBuilder.buildSystemPrompt(profile, locale)` are called once per chat request inside the chat handler. They are the only points where Profile data feeds into the LLM call.
- The chat handler stops importing tool definitions or prompt fragments directly. Its dependencies become: ProfileLoader → ToolRegistry → LLM client.
- The MCP server is unchanged. It still hits `/_v/acg/*` HTTP routes. The Adapter is still the only place with business logic.

### Schema and storage

- Profiles are YAML files. Initial location: a `profiles/` directory inside the Adapter package. The exact path is an implementation detail of `ProfileLoader`.
- The schema covers everything the existing TS `ClientConfig` covers (account matching, industry, currency, locales, brand, llmContext, customRules, confirmationStyle, multiStepFlow, starters, strings) plus filter definitions as a discriminated union for forward-compatibility with the widget filter-component registry (separate PRD).
- Validation happens at cold start. If any Profile fails, the Adapter logs the validation error and the loader returns the default Profile for unmatched accounts. Whether to hard-fail vs degrade-to-default is a triage question worth resolving — current preference: hard-fail on a profile that *would* match the current account, soft-fail (skip + log) on others.
- Hot reload is **not** in scope. Profile changes take effect on the next IO cold start.
- The two existing profiles (`default`, `miniprix`) are ported to YAML verbatim. The TS profile files are deleted.

### API contracts

- `GET /_v/acg/config` — response shape unchanged. Same fields, same caching behaviour (`Cache-Control: public, max-age=300`).
- The chat handler's HTTP contract is unchanged — only its internal composition changes.
- No new outbound hosts; no `manifest.json` policy changes.

### Architectural decisions

- **Schema-first.** The zod schema is the contract. TS types are derived from it. There is no parallel `interface ClientConfig` definition. ADR-worthy decision; will be captured in `docs/adr/` after triage.
- **Per-chat tool selection.** Industry bundles are selected per chat based on the active Profile's `industry`. We never load all bundles simultaneously. Justified by the Engine invariant on token cost (`CONTEXT.md` #9).
- **Storage encapsulated behind ProfileLoader.** Today: filesystem YAML. Future v2: VBase. Future v3: admin-UI-managed. None of these moves should require touching callers.
- **Industry bundles own their tools and their preamble fragment.** Each bundle module is the single place to look when reasoning about a vertical's behaviour. Adding a vertical = new module + one registry entry.
- **Generic / unknown industry returns core only.** Misconfigured Profiles degrade to a working baseline rather than crashing.
- **No Engine code paths change.** The chat loop, AP2 core, RAG, mappers, and Surfaces are untouched. This is a Layer 1 + Layer 2 change as defined in `CONTEXT.md` §5.

## Testing Decisions

A good test here exercises **external behaviour only** — given a Profile (or YAML file, or account name), what does the module return? Tests do not mock the schema, do not introspect cache internals, and do not assert on log output. The four pure modules listed below are the behavioural surface; the test plan covers them and stops there.

### Modules to test

- **ProfileSchema** — fixture YAMLs (valid `default`, valid `miniprix`, plus a curated set of malformed inputs: missing required field, wrong filter `type`, accent color in the wrong format, unknown industry). Each fixture either parses cleanly or fails with a message that identifies the offending path. The malformed fixtures double as reference documentation for what the schema rejects.
- **ProfileLoader** — given a fixture profiles directory, verify: account-name match resolution (case-insensitive, multiple `accountMatches` entries), fallback to `default` when no match, behaviour when a Profile fails validation (hard-fail on the matching Profile, log + skip on non-matching ones — pending triage of soft vs hard). Caching is verified by asserting the loader returns the same instance on repeated calls.
- **SystemPromptBuilder** — snapshot test per `(industry, locale)` combination. Verifies that `llmContext`, `customRules`, brand tone, and the industry preamble all appear in the prompt. The snapshots commit so prompt regressions are obvious in PR diffs.
- **ToolRegistry** — for each industry, the returned tool list matches the expected set (a small explicit list). For `generic` and unknown industries, the returned list equals `CORE_TOOLS`. The test also asserts an upper bound on tool count (cost invariant) — if a bundle starts adding tools beyond a threshold, the test fails so it's reviewed deliberately.

### Modules NOT tested at this stage

- **Industry tool *handlers*** (`find_outfit`, `compare_specs`, `suggest_recipe`, etc.) — these need an LLM in the loop and are better covered by a small e2e harness. Each per-bundle PRD will own its handler tests.
- **Config Endpoint** — covered by the existing handler-level smoke tests; the change is a one-line source swap. If a regression appears, it'll surface through the widget's existing config-fetch flow.
- **Chat handler** — untouched at the behavioural level. Its dependencies move from inline constants to module calls; behaviour is identical.

### Prior art

- `packages/core/*.test.ts` — uses Node's native `--test` runner via `tsx`. 68 tests cover JCS canonicalization, DID, mandates, keystore. Same pattern, same tooling for these new tests. The Adapter package (`vtex-io-adapter`) has only a stub Jest test (`__tests__/simple.test.ts`); the new tests will sit alongside their modules and use the `tsx` + `node --test` pattern from `@acg/core` for consistency, not Jest.

## Out of Scope

- **Hot reload / file-watching.** Profile changes take effect on next cold start. (v2.)
- **VBase or admin-UI storage backend** for profiles. (v2 / v3, the swap point is `ProfileLoader` and is designed for that.)
- **Filter component registry on the widget side.** The schema validates filter definitions, but the `<ColorSwatches>` / `<PriceSlider>` / `<ConditionalChips>` work on the widget is a separate PRD (`docs/ARCHITECTURE.md` Phase 4).
- **Industry tool *handler* implementations.** Stubs returning "not yet implemented" payloads land here so the wiring is end-to-end visible. Real handlers (`find_outfit` fanning out four parallel `search_products` calls; `compare_specs` building a side-by-side; etc.) are per-bundle PRDs.
- **Migrating LLM / Pinecone keys out of `manifest.json`'s `settingsSchema`.** Those are operator-set per environment, change rarely, and stay in VTEX app settings.
- **AP2 / mandate work, RAG pipeline, MCP server, payment flow.** Untouched.
- **Backwards compatibility with `node/config/profiles/*.ts`.** Per `CLAUDE.md` "Conventions", we don't keep deprecated shims when we can just change the code. The TS profile files are removed in this PRD's implementation.

## Further Notes

- **Today there's exactly one configured merchant** (`miniprix`) plus the default fallback. This PRD is the foundation that makes "two real merchants without code edits" sustainable. The case-study narrative in `docs/SHOWCASE_PLAN.md` ("platform, not template") only lands once that's true.
- **Architectural source.** This work bundles Phase 2 (YAML-driven config) and Phase 3 (industry tool bundles) from `docs/ARCHITECTURE.md`. They're combined because the bundle dispatch reads `profile.industry`, which only exists meaningfully once the Profile system is real.
- **CONTEXT invariants checked.**
  - #1 (orderFormId is cart identity) — untouched.
  - #2 (Layer 4 is merchant-agnostic) — preserved; Engine code paths don't change.
  - #6 (all business logic in the Adapter) — preserved.
  - #7 (outbound hosts declared in manifest) — no change required.
  - #8 (Profile changes are zero-code) — this PRD is the work that makes #8 actually true.
  - #9 (tool descriptions cost tokens on every chat call) — directly motivates per-chat bundle selection.
- **Vocabulary watch.** "Profile" (the per-merchant config) and "app settings" (LLM keys etc. in `manifest.json`) are different things; both are sometimes called "config." This PRD uses **Profile** strictly and never overloads "config."
- **Triage questions worth resolving before `ready-for-agent`:**
  - Hard-fail vs soft-fail on a malformed Profile that *doesn't* match the current account — preference is soft-fail (skip + log) so one merchant's bad YAML doesn't take down everyone else's.
  - Whether industry-bundle tool *handler stubs* should return a clearly-wrong sentinel or a "this assistant doesn't support that yet" message — affects shopper-facing behaviour during the rollout window.
  - Profile directory location (`packages/vtex-io-adapter/node/profiles/`? a top-level `profiles/` synced into the package via the same script as shared types?). Implementation detail, but worth picking one.
