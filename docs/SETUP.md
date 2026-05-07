# Setup Guide

Get the ACG demo running in 30 minutes.

## Prerequisites

- Node.js 18+
- VTEX CLI (`npm install -g vtex`)
- VTEX account with test store
- Claude Desktop installed

## Step 1: VTEX IO Adapter

### 1.1 Update manifest.json

Edit `packages/vtex-io-adapter/manifest.json`:
- Change `"vendor": "yourvendor"` to your VTEX vendor name

### 1.2 Login to VTEX

```bash
cd packages/vtex-io-adapter
vtex login your-account-name
```

### 1.3 Link the app

```bash
vtex link
```

You should see output like:
```
info: Build accepted for yourvendor.acg-adapter@0.0.1
```

### 1.4 Configure app settings (REQUIRED before any call succeeds)

The adapter ships with **fail-closed security**: until you set the
allowlist + auth token, every `/_v/acg/*` call returns 403. Open VTEX
Admin → Apps → Agent Commerce Gateway Adapter → Settings, and fill in:

| Setting | Required | Value |
|---|---|---|
| `acgAllowedOrigins` | yes (for the widget) | List of storefront origins, e.g. `["https://your-store.myvtex.com", "https://www.your-store.com"]` |
| `acgAuthToken` | yes (for MCP / Claude Desktop) | Any random 32+ character string. `openssl rand -hex 32` works. Save this — you'll paste it into the Claude Desktop config in Step 3. |
| `acgRateLimits` | optional | Override default per-IP rate limits per route class. Defaults: `chat 20/min, 200/day · mutating 30/min, 500/day · read 60/min, 2000/day` |
| `acgSessionDailyLimit` | optional | Per-orderForm 24h request cap. Default: 100. |

LLM keys (`claudeApiKey` etc.) and Pinecone keys belong in the same
settings panel — see the schema in `manifest.json` for the full list.

The DID document routes (`/_v/acg/.well-known/did.json` and the two
mock-party variants) plus the artifact retrieval routes
(`/_v/acg/mandates/:id`, `/_v/acg/payment-mandates/:id`,
`/_v/acg/receipts/:id`) bypass the allowlist by design — they're the
AP2 verification surface and must remain reachable by any third-party
verifier. They're still IP rate-limited.

### 1.5 Test the endpoints

```bash
# DID document is publicly reachable
curl "https://master--your-account.myvtex.com/_v/acg/.well-known/did.json"

# Search requires either the storefront Origin header or the auth token
curl -H "X-ACG-Auth-Token: <your-token>" \
  "https://master--your-account.myvtex.com/_v/acg/search?q=shoes&limit=3"

# Without auth → 403 forbidden (this is correct)
curl "https://master--your-account.myvtex.com/_v/acg/search?q=shoes"
```

## Step 2: MCP Server

### 2.1 Install dependencies

```bash
cd packages/mcp-server
npm install
```

### 2.2 Build the server

```bash
npm run build
```

### 2.3 Configure environment

Create a `.env` file or set environment variables:

```bash
export VTEX_ACCOUNT=your-account-name
export VTEX_WORKSPACE=master
# Optional if your endpoints are public:
# export VTEX_APP_KEY=your-app-key
# export VTEX_APP_TOKEN=your-app-token
```

### 2.4 Test the server locally

```bash
npm start
```

## Step 3: Claude Desktop Configuration

### 3.1 Find config file location

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### 3.2 Add MCP server config

Edit the config file:

```json
{
  "mcpServers": {
    "vtex-store": {
      "command": "node",
      "args": ["/full/path/to/AP2/packages/mcp-server/dist/index.js"],
      "env": {
        "VTEX_ACCOUNT": "your-account-name",
        "VTEX_WORKSPACE": "master",
        "ACG_AUTH_TOKEN": "<the-same-token-you-set-as-acgAuthToken-in-VTEX-Admin>"
      }
    }
  }
}
```

**Important:**
- Use the full absolute path to the built `index.js`
- `ACG_AUTH_TOKEN` must match the `acgAuthToken` app setting from Step 1.4 verbatim. The MCP server has no Origin header (stdio → HTTPS); without this the adapter returns 403 on every call.

### 3.3 Restart Claude Desktop

Completely quit and reopen Claude Desktop.

### 3.4 Verify connection

In Claude Desktop, you should see a tools icon. Click it to verify "vtex-store" server is connected with tools like:
- searchProducts
- addToCart
- getCart
- proposeDeal
- checkout

## Step 4: Test the Flow

Open Claude Desktop and try:

```
Search for shoes in my store
```

Claude should call the `searchProducts` tool and return results from your VTEX store.

Then try:
```
Add the first one to my cart
```

```
What deals do you have?
```

```
Let's buy it
```

## Troubleshooting

### "VTEX API error: 404"
- Make sure the VTEX IO app is linked: `vtex link`
- Check the workspace name matches

### "MCP server not showing in Claude"
- Verify the path in config is correct (use absolute path)
- Check the JSON is valid (no trailing commas)
- Restart Claude Desktop completely

### "No products found"
- Make sure your VTEX store has indexed products
- Try searching for a known product name

### "Cookie/session issues"
- The demo uses cookies for cart persistence
- This works when called from browser but may have issues from MCP
- For MCP, we may need to pass session ID explicitly (future improvement)

## Next Steps

Once basic flow works:

1. Polish the payment page styling
2. Add more intelligence rules
3. Test on different product types
4. Record the demo video

## Quick Reference

| Command | Description |
|---------|-------------|
| `vtex link` | Start VTEX IO development |
| `vtex browse` | Open store in browser |
| `npm run dev` | Start MCP server with hot reload |
| `npm run build` | Build MCP server for production |
