# Feishu Bot — Kailash Energy

Feishu long-connection bot for the Kailash Energy store, running on the
Singapore server. It answers in Feishu direct messages (and in groups when
@mentioned), reads Feishu docs and Bitables, keeps a conversation history and
a knowledge base, runs deep analysis with GPT, and queries Shopify in
read-only mode.

## Why long connection, not webhook

Feishu's servers in China cannot reach overseas domains such as
`vercel.app` or `workers.dev` within the 3-second verification window, so
the webhook route was abandoned after repeated timeouts. This bot uses the
official Feishu Node SDK (`@larksuiteoapi/node-sdk`) `WSClient` long
connection instead — no public URL is needed.

## Deploy

```bash
npm install
cp .env.example .env   # fill in real values
node server.js         # or run as a systemd service with EnvironmentFile=.env
```

Requires Node 18+.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `FEISHU_APP_ID` | Feishu self-built app ID |
| `FEISHU_APP_SECRET` | Feishu app secret |
| `OPENAI_API_KEY` | OpenAI API key (chat + summaries) |
| `OPENAI_MODEL` | Chat model, default `gpt-4o-mini` |
| `ANALYSIS_MODEL` | Deep-analysis model, default `gpt-4o` |
| `SHOPIFY_STORE` | Store domain, e.g. `kailashenergy.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API token, **read-only** |

## Notes

- Never commit `.env`, real keys, tokens, or verification codes.
- The Shopify token must have read-only scopes only
  (`read_orders`, `read_customers`, `read_products`). The bot never
  modifies orders.
- Data conventions: store time is EST (UTC-5); Meta spend is the combined
  main + shop account total; Google conversions count shopping purchases only.
