# Kailash Energy CRM 2.0 — 后端独立授权清单

最后更新：2026-11-08

## 授权不是 ChatGPT 连接状态

ChatGPT 中的 Shopify、Gmail 连接**不会**将 OAuth / Admin API 凭据提供给 Vercel。CRM 代码已部署，但后端两项授权目前仍缺失，必须在来源系统创建凭据并放入 Vercel 的 Sensitive environment variables，不能粘贴在群聊、GitHub、工单或此文档中。

## Vercel 目标项目

Project: `kailash-energy-ai-knowledge-hub`
Environment: `Production`
Settings → Environment Variables

### Shopify

- `SHOPIFY_SHOP_DOMAIN` = `41e513.myshopify.com`（已配置）
- `SHOPIFY_ADMIN_ACCESS_TOKEN` = 通过 Shopify 已安装自建应用获得的 Admin API access token（缺失，必须用户在 Shopify 后台创建/安装/授权）
- 读取权限：`read_customers`, `read_orders`；若需要大于默认历史窗口的订单，申请适用的 `read_all_orders` 访问权限。
- 不授予 Shopify 数据写入权限。请使用只读应用。

### Gmail

Google Cloud OAuth2 consent + Gmail readonly API:
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

配置 Google Cloud OAuth 客户端，开启 Gmail API，用 `https://www.googleapis.com/auth/gmail.readonly` 获取对应邮箱的离线 refresh token。密钥及 refresh token 仅保存到 Vercel Sensitive production env，避免被写入 GitHub。

### 应用连接检查

`GET /api/crm-status` 返回：
- `source_connectors.shopify_backend_authorized`
- `source_connectors.gmail_backend_authorized`

两项为 true，才会在每日定时任务中启动独立源数据同步。

## 当前代码能力与限制

- `lib/crm-shopify.js`：2026-10 Admin GraphQL 分页读取客户、180天订单；并严格排除无效订单。
- `lib/crm-gmail.js`：Gmail OAuth refresh、只读消息元数据与 thread ID。
- `lib/crm-feishu.js`：只对原有两张CRM表按 Shopify ID / Gmail Message ID 去重并增量写入；不覆盖人工画像与维护记录。
- `api/crm-import.js`：每日分批同步、私有 Blob 游标、失败重试入口。历史全量导入需要多个批次和数据总量验收。
- `lib/crm-rfm.js`：最终 S+/S/A/B 条件，B 级 M>$0。

目前客户同步只写入可验证的基础字段；**180天准确 M/R/F 及真实心理画像仍需完整订单汇总、证据关联和人工复核功能进一步接入**。不得把历史累计消费当成近180天 M。

## 安全验收

1. 同步代码只访问 `Y7VvbgreAasoLtsYdhrcmmDUn5d` 两张现有 CRM 表。
2. 商品资产库与 Shopify 商品、订单均不会发生写操作。
3. 首次同步后按 Shopify customer ID 和 Gmail message ID 对账，避免重复客户和工单。
4. 未授权、记录冲突、金额未知、跨币种、退款/取消订单归入待核验，绝不静默补 0。
5. 不自动回复客户或向客户发送营销内容。
