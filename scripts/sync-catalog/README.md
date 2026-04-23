# Catalog Sync Script

Syncs a VTEX catalog into a Pinecone vector index for semantic search.

## Setup

```bash
cd scripts/sync-catalog
cp config.example.json config.json
# Fill in your VTEX, OpenAI, and Pinecone credentials in config.json
npm install
```

## Usage

```bash
# Estimate cost before running (no API calls)
npm run estimate

# Full sync (resumes if .sync-state/ exists)
npm run sync

# Force fresh sync (clears state + Pinecone namespace)
npm run fresh

# Retry only failed products from error queue
npm run retry

# Sync only first N products (for testing)
tsx index.ts --limit 100

# Override concurrency
tsx index.ts --concurrency 30

# Use a different config file
tsx index.ts --config /path/to/other-config.json
```

## State files

```
.sync-state/
├── state.json          # Resume state: processed IDs, cursor position
└── errors.json         # Failed products for later retry

logs/
└── sync-<timestamp>.ndjson   # Structured logs, one JSON object per line
```

## Querying logs

```bash
# Tail live logs
tail -f logs/sync-*.ndjson | jq .

# Filter errors
cat logs/sync-*.ndjson | jq 'select(.level == "error")'

# Count products by phase
cat logs/sync-*.ndjson | jq -r '.phase' | sort | uniq -c
```

## Architecture

1. **Fetch product IDs** from VTEX `GetProductAndSkuIds` (paginated)
2. **Batch process** 20 products at a time:
   - Fetch product details (parallel)
   - Build embedding text (smart trimming to token budget)
   - Embed via OpenAI (batched)
   - Upsert vectors to Pinecone
   - Update state + log progress
3. **Resume-safe**: state is written atomically after each batch
4. **Error-resilient**: failed products go to error queue, never halt the sync

## Token budget

- **HARD MAX:** 1,000 tokens per product (~4KB text)
- **SOFT TARGET:** 500 tokens per product (~2KB text)
- Structured fields (name, category, brand, specs) kept in full
- Description truncated smartly at sentence/word boundaries
