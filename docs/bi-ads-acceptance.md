# PR #51 验收任务单：第6节
以下验收标准由用户在本聊天提供，记录于2026-11-12。未执行项不能标记通过。

## 6. 验收标准

用已知日期对账，全部通过才算接好：

1. `GET /api/bi-ops-dashboard?start=2026-11-10&end=2026-11-10`（带 BI token）返回里有 `ads.meta` 和 `ads.google`，且 `generatedAt` 是本次刷新时间，不是旧快照。
2. 2026-11-10：Shopify GMV $1,097.71、7 单不变；Google 花费与 2026-11-11 晚修日报时浏览器实查的 $25.24 对上（±$0.05）。Meta 11-10 花费与 Ads Manager 当天数对上（±$0.05），ROAS = 收入 / 花费可复算。
3. 2026-11-09：Meta 花费与日报口径 $944.45 对上（后台结算时曾读到 $953.89，差额要在返回里注明是结算中修订，不要硬凑）。Google 11-09 花费与后台实查对上。
4. 断一家不断全家：把 Meta token 临时改错（测试环境），刷新后 Shopify + Google 仍写回，Meta 那块标 stale、有上次成功时间；恢复 token 后下一次 cron 自动恢复。
5. 打开 BI 运营总览，能看到 Meta / Google / 合计三行，数字与接口返回一致，来源写明 API，不是 UTM 归因 GMV。
6. Vercel 部署成功，`vercel.json` 里 `/api/bi-ops-dashboard` 的 30 分钟 cron 不变，无新增密钥进仓库（`git grep -i token` 不应命中真实 token）。

## 同一聊天中已批准的口径调整与基准说明

- Google按账户原生GMT−04:00切日，须用真实customer.time_zone核验；Meta仍为固定EST UTC−5。原始每日数据不重切日，也不互换标签。
- 保留Meta / Google / 合计三行，但因日界线不一致，合计花费、收入与ROAS为null；页面说明原因。不得把两种日界线的金额直接相加。
- Google 11-10 $25.24为用户确认的实测基准：2026-11-10可视化日报快照，asOf 2026-11-11T15:16:07Z；Google Ads后台Kailash Energy01-1（267-002-1803）11-10单日实查，购物购买0、加购1、发起结账0，已写入Midas表11-10行。本轮尚未独立读取原始快照/Midas表。当前API仅实现购买action，加购和结账为null，需另列证据和缺口。
- Google 11-09实际后台金额尚未提供；Meta 11-10实际后台金额尚未提供，均待同口径平台证据。
- 验收时可用refresh=1明确触发刷新，逐项核对Shopify及每个平台的generatedAt / lastSuccessfulAt / cached / stale，不能只看合并响应的generatedAt。
- $944.45与$953.89是历史参考，差额$9.44；实时API金额必须原样记录，进一步差异仍需证据解释，不能强凑或仅凭历史说明宣称当前差异已解决。
- 故障隔离只在隔离测试环境使用测试专用凭据，不复制生产凭据到Preview，不修改Production token。恢复后的cron自愈还需实际执行证据；现有mock测试不能替代。
- 用户指定主聊为Muse交接位置，无需继续寻找侧边聊。本轮收到材料不代表Muse已经执行；不操作Muse新加坡服务器。

## 当前状态

代码/模拟测试已完成；真实业务验收未执行。缺少Meta API版本、Google生产配置/权限/购买action确认及真实账户时区核验；发布门槛、明确发布授权和实际Production部署仍需按流程核实。不得把构建READY、mock测试或用户给定基准当作真实对账通过。
