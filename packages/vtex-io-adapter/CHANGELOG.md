# Changelog

All notable changes to the ACG VTEX IO adapter will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- AP2 v0.2 mandate ceremony: CartMandate (merchant), PaymentMandate (CP), PaymentReceipt (network)
- Ed25519 + JCS (RFC 8785) + `did:web` signing primitives
- `/_v/acg/.well-known/did.json` DID document publication
- Independent verification routes: `/mandates/:id`, `/payment-mandates/:id`, `/receipts/:id`
- LLM chat handler with Claude / OpenAI / Gemini providers
- Pinecone-backed RAG over VTEX catalog
- Origin-allowlist + shared-secret middleware (`require-origin-or-secret`)
- Per-IP rate limiting and per-session daily cost cap
- Force-reject flag for demo/staging payment rejections
- Config-driven merchant profiles (`node/config/profiles/*`)

## [0.0.2] - 2026-05

Initial public release.
