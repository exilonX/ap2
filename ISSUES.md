# Issues

Small standalone issues. Multi-issue features live as PRDs under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md` for layout rules.

---

## 0001 — Move local-dev secrets out of `key.txt`

- **Status:** needs-triage
- **Created:** 2026-05-05
- **GitHub:** _(filled when promoted)_

### Context

`packages/vtex-io-adapter/key.txt` carries live secrets in plaintext: Pinecone API key, OpenAI API key, and a VTEX app key/token pair. The file is **gitignored** (`.gitignore` line 4) and is not tracked in git history — secrets are not on GitHub.

Why it's still worth fixing:

- **The gitignore line is the only thing standing between live keys and a future `git add -A`.** Anyone removing or restructuring the gitignore (mass clean-up, monorepo split, build-tool migration) without noticing this line could publish the keys.
- **None of these belong in a flat text file.** The runtime-relevant ones (Pinecone, OpenAI) come from `manifest.json`'s `settingsSchema` and are set via VTEX Admin UI per environment — they should never leave the admin. The dev-tooling ones (VTEX app key/token) belong in standard `.env` style or in the script-specific config file (`scripts/sync-catalog/config.json` already has the same shape).
- **The filename is misleading** — `key.txt` reads as "merchant signing key," which is exactly what ADR-0001 says must never sit in a flat file. Removing it eliminates the ambiguity.

No code in the repo reads `key.txt` directly — it's used as a developer's copy-paste reference, not a runtime config source.

### Acceptance

1. Delete `packages/vtex-io-adapter/key.txt`. Anyone who needs the values for local setup re-fetches them from VTEX Admin / Pinecone console / OpenAI dashboard / `vtex local token`.
2. Document the canonical home for each kind of secret in `docs/SETUP.md` (or wherever the setup guide lives):
   - **Pinecone / OpenAI / Gemini / Claude API keys** → VTEX Admin → App Settings for `vtexeurope.acg-adapter` (per `manifest.json` `settingsSchema`).
   - **VTEX app key / token for scripts** → `scripts/sync-catalog/config.json` (already gitignored via the script's own conventions; verify) or a `.env` file at the repo root.
3. Keep the `packages/vtex-io-adapter/key.txt` line in `.gitignore` as defense-in-depth — costs nothing, prevents accidental recreation.
4. (Optional) Add a `key*.txt` glob to `.gitignore` to catch future variants like `keys.txt`, `secrets.txt`, etc.

### Comments

Surfaced 2026-05-05 during ADR-0001 grilling. Not demo-blocking, not architecture-blocking — small hygiene task. Sized for a single 30-minute pass; does not warrant a full PRD or feature folder.
