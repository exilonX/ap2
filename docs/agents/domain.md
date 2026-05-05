# Domain Docs

This repo is **single-context**: one `CONTEXT.md` at the root, ADRs under `docs/adr/`. The whole project serves a single purpose (e-commerce middleware), so sub-domains (Discovery, Cart Negotiation, Mandate, Checkout, Personalization) are sections inside `CONTEXT.md` rather than separate context files per package.

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-…
│   └── 0002-…
└── packages/, apps/, scripts/
```

## Use the glossary's vocabulary

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids — particularly for Mandate types, OrderForm vs SimpleCart, Profile vs app settings, Surface vs Adapter (see `CONTEXT.md` §7 "Vocabulary in flux").

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
