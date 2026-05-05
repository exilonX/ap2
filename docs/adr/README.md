# Architecture Decision Records

ADRs capture significant architectural decisions: what we chose, what we rejected, and why. They're append-only — when a decision is reversed, write a new ADR that supersedes the old one rather than editing it.

## Conventions

- File names: `NNNN-short-slug.md`, numbered from `0001`
- One decision per file
- Status: `proposed` | `accepted` | `superseded by ADR-NNNN`

## Template

```markdown
# ADR-NNNN: Short title

- **Status:** proposed | accepted | superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context

What forces are at play? What's the problem?

## Decision

What did we choose, in one paragraph.

## Consequences

What becomes easier? What becomes harder? What did we give up?

## Alternatives considered

Brief notes on what else was on the table and why each was rejected.
```

ADRs are produced lazily — `/grill-with-docs` writes them when an architectural decision actually crystallises during a planning conversation.
