# Issue tracker: Local Markdown (hybrid) → GitHub (future)

Issues and PRDs for this repo live locally. Once an issue is crystal-clear and ready to be acted on, it gets promoted to GitHub Issues at [exilonX/ap2](https://github.com/exilonX/ap2). The `gh` CLI is **not yet installed** — install it and run `gh auth login` before promoting anything.

## Where things live

- **`ISSUES.md`** at the repo root — flat list of small standalone issues (bugs, single tasks, follow-ups). One issue per `## ` heading, numbered manually: `## 0042 — short title`.
- **`.scratch/<feature-slug>/`** — folder per multi-issue feature.
  - `PRD.md` — the PRD produced by `/to-prd`
  - `issues/<NN>-<slug>.md` — implementation issues produced by `/to-issues`, numbered from `01`
  - Anything else relevant to the feature

## Routing rules

When a skill produces an issue or PRD, decide where it goes:

| Output | Destination |
|---|---|
| A PRD | `.scratch/<feature-slug>/PRD.md` (always — PRDs are too long for `ISSUES.md`) |
| Implementation issues sliced from a PRD | `.scratch/<feature-slug>/issues/<NN>-<slug>.md` |
| A standalone bug or task with no child issues | New entry in `ISSUES.md` |
| A follow-up surfaced mid-conversation | New entry in `ISSUES.md` (promote later if it grows) |

When in doubt, start in `ISSUES.md`. If it grows, migrate to `.scratch/<feature>/`.

## Issue file format

Whether the issue lives in `ISSUES.md` or as a file under `.scratch/`, it starts with:

```markdown
## NNNN — Short title

- **Status:** needs-triage | needs-info | ready-for-agent | ready-for-human | wontfix
- **Created:** YYYY-MM-DD
- **GitHub:** _(filled when promoted)_

### Context
…

### Acceptance
…

### Comments
…
```

For files under `.scratch/<feature>/issues/`, the `## NNNN` heading is the file's top-level heading.

## When a skill says "publish to the issue tracker"

- PRDs → write `.scratch/<feature-slug>/PRD.md` (creating the directory)
- Implementation issues from `/to-issues` → write `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Single-issue items → append a new section to `ISSUES.md`

Apply `Status: needs-triage` by default unless the skill specifies otherwise.

## When a skill says "fetch the relevant ticket"

- If the user gave a number, look in `ISSUES.md` first
- Otherwise read the file at the referenced path
- If only a slug is known, search both `ISSUES.md` and `.scratch/**/PRD.md`

## Promoting to GitHub

When an issue is crystal-clear and ready to be acted on:

1. Install `gh` (`winget install --id GitHub.cli` on Windows) and run `gh auth login`.
2. `gh issue create --repo exilonX/ap2 --title "<title>" --body-file <path>`.
3. Apply the triage label: `gh issue edit <num> --add-label <status>`.
4. Update the local issue's `**GitHub:** #<num>` line.
5. Optionally archive the local file (move to `.scratch/<feature>/issues/_archived/`, or strike through the `ISSUES.md` entry).

Re-run `/setup-matt-pocock-skills` after `gh` is installed to flip the skills' default destination from local to GitHub.
