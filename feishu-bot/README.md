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
| `CRM_ALLOWED_OPEN_IDS` | Comma-separated Feishu sender `open_id` allowlist for private CRM queries; empty disables CRM queries |

## CRM read-only tools (no extra credentials)

The three CRM tools use the existing Feishu SDK client and the bot's existing
`FEISHU_APP_ID` / `FEISHU_APP_SECRET`. They access only the two existing Bitable
tables in app `Y7VvbgreAasoLtsYdhrcmmDUn5d`:

- `crm_find_customer`: exact email or Shopify Customer GID; name matches must be unambiguous.
- `crm_list_segment`: CRM grade **or** one of the eight RFM groups; max 20 displayed records.
- `crm_customer_communications`: customer email; max 10 communication summaries.

All three tools are **read-only** and allowed only in Feishu one-to-one chats
from `open_id`s explicitly listed in `CRM_ALLOWED_OPEN_IDS`. Unset/empty means
deny by default. No CRM tool reads or writes Vercel Blob, Shopify, Gmail,
knowledge.json, or local history directly. The chat application already stores
conversation replies in local history, so treat access to that directory as sensitive.

Before enabling, grant the bot application **read** access to the CRM Bitable
and verify that its own tenant token can list both tables. No new CRM API
keys are required. Missing CRM grade/RFM values are *not calculated* by the bot;
the answer is `尚未完成计算`. Repeat-purchase answers always name their time period.

### Smoke test after Muse deploys

1. Set `CRM_ALLOWED_OPEN_IDS` to the authorized tester's real Feishu `open_id`
   in the server-only `.env`; never commit that value.
2. In the authorized user's one-to-one chat, ask for one known CRM customer by
   email and compare the result with the Feishu customer master.
3. Ask for `CRM等级=S+`, then an RFM group. Confirm the query reads only the
   verified customer table and gives a limited page, not an invented full list.
4. Ask in a group chat or from an unlisted user; both must be denied.
5. Verify that empty grades return `尚未完成计算` and that historical vs 180-day
   repeat purchase is explicitly differentiated.

## Notes

- Never commit `.env`, real keys, tokens, or verification codes.
- The Shopify token must have read-only scopes only
  (`read_orders`, `read_customers`, `read_products`). The bot never
  modifies orders.
- Data conventions: store time is EST (UTC-5); Meta spend is the combined
  main + shop account total; Google conversions count shopping purchases only.
