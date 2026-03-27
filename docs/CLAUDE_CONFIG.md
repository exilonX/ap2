# Claude Desktop Configuration

How to configure Claude Desktop to use the ACG MCP server.

## Config File Location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

## Configuration

```json
{
  "mcpServers": {
    "vtex-store": {
      "command": "node",
      "args": [
        "G:/code/vtex/AP2/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "VTEX_ACCOUNT": "your-vtex-account",
        "VTEX_WORKSPACE": "master"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VTEX_ACCOUNT` | Yes | Your VTEX account name |
| `VTEX_WORKSPACE` | No | Workspace (default: "master") |
| `VTEX_APP_KEY` | No | API key for authenticated endpoints |
| `VTEX_APP_TOKEN` | No | API token for authenticated endpoints |

## Available Tools

Once connected, Claude will have access to:

### Search
- **searchProducts** - Search for products in the store
  - Parameters: `query`, `maxResults`, `category`, `minPrice`, `maxPrice`

- **getProductDetails** - Get details for a specific SKU
  - Parameters: `sku`

### Cart
- **addToCart** - Add item to cart
  - Parameters: `sku`, `quantity`

- **getCart** - Get current cart contents

- **removeFromCart** - Remove item from cart
  - Parameters: `sku`

### Intelligence
- **proposeDeal** - Get smart deal suggestions based on cart

### Checkout
- **checkout** - Start checkout, returns payment page URL

- **checkOrderStatus** - Check order status after payment
  - Parameters: `orderId`

## Verifying Connection

1. Open Claude Desktop
2. Look for the tools icon (hammer) in the input area
3. Click it to see connected servers
4. "vtex-store" should appear with the tools listed

## Example Conversations

### Product Search
```
User: Search for running shoes under $150

Claude: [Calls searchProducts with query="running shoes", maxPrice=150]
        Found 5 products:
        1. Nike Air Max 90 - $142.00
        2. Adidas Ultraboost - $149.99
        ...
```

### Building a Cart
```
User: Add the Nike ones to my cart

Claude: [Calls addToCart with sku="12345", quantity=1]
        Added to cart!
        Current Cart:
        - Nike Air Max 90 × 1 = $142.00
        Total: $142.00 USD
```

### Getting Deals
```
User: Any discounts available?

Claude: [Calls proposeDeal]
        Available Deals:
        1. Buy 2 and get 10% off
        2. As a valued customer, I can offer 15% off - save $21.30!

        My Recommendation: Take the VIP discount for maximum savings.
```

### Checkout
```
User: Let's buy it

Claude: [Calls checkout]
        Ready to complete your purchase!

        Order Summary:
        - Items: 1
        - Total: $142.00 USD

        Click here to pay: https://your-store.myvtex.com/_v/acg/checkout/pay/abc123

        This link expires in 10 minutes.
```

## Troubleshooting

### Server not appearing
1. Check JSON syntax (no trailing commas)
2. Verify path is absolute and correct
3. Ensure `dist/index.js` exists (run `npm run build`)
4. Fully restart Claude Desktop

### Tools not working
1. Check VTEX_ACCOUNT is correct
2. Verify VTEX IO app is linked (`vtex link`)
3. Test endpoint directly: `curl https://master--account.myvtex.com/_v/acg/search?q=test`

### Permission errors
1. For authenticated endpoints, add VTEX_APP_KEY and VTEX_APP_TOKEN
2. Check VTEX app policies in manifest.json
