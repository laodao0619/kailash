# BI 广告 API 接入：交付给验证方

范围：只修改 BI 代码。没有改飞书机器人代码、没有增加 cron、没有创建/修改/暂停广告或预算。Meta 优先，Google 等权限。当前真实 API 验收尚未完成，不能据此声称接通。

## 已实现

- Meta 两主账户严格白名单：810672167888307、1559163378893343。USD、每日 account 汇总 headline；campaign/adset/ad 不重复计入总额。
- actions/action_values 的 purchase/add_to_cart/initiate_checkout 别名选一个，不累加同一事件别名。以API返回标准purchase为第一优先，其次pixel，再其次omni；与后台购买列对账时必须核对这份映射。
- 每日、账户、campaign/adset/ad 数据、命名测试点、广告创建时间、可读的创意链接。创建时间不声称是实际首发时间；没有链接就标缺失。详情分页受每账户75次调用预算与整体45秒时间预算约束；详情不完整时`detailsComplete=false`并附`detailErrors`，不得作为全量测试点验收通过。
- Google 代码已预备，默认不拉取，`GOOGLE_ADS_ACCESS_APPROVED=true`后才尝试。先列conversion action，明确白名单且category=PURCHASE、ENABLED、primaryForGoal=true后拉购买，主/次转化不一致时拒绝默默少算。
- Google 成本无action分段单独查询；购买按所选action拉取互动日期与转化日期两套指标，不使用全部转化。
- Meta、Google私有缓存各自独立落盘，另一家挂起/失败不阻止已完成者保存；Shopify独立先落盘，再写合并快照。
- 失败保留同日期范围最近成功值，标`stale`、`error`、`lastSuccessfulAt`；无成功值显示null，不填0。失败30分钟冷却，手动`refresh=1`可提前重试。
- provider缓存30分钟；Shopify仍是2小时；现有每30分钟cron不动。默认页和同日期的自定义范围复用广告缓存。每次打开页面不强制拉平台API。自定义多个不同日期范围和强制刷新仍可能提高额度消耗，验证时不要并发批量轰炸。
- 合计只在两平台同时新鲜且USD、日期范围和日界线均相同时计算；当前Meta EST与Google GMT−04:00不满足此条件，合计为null；总收入是平台各自归因之和，可能重复归因同一订单，不能当去重收入或Shopify MER。

## 先纠正任务单里的两处前提

1. Google官方已于2026-09-09停用旧developer-token申请模型。新应用在Google Cloud项目的Google Ads API Overview申请Explorer（真实账户）/Basic权限，MCC和旧开发者令牌不再是新接入的强制前提。现有MCC有没有仍未核实，任务单没有MCC ID，不要填假的login-customer-id。通过经理访问客户时才配置真实的GOOGLE_ADS_LOGIN_CUSTOMER_ID。按账户界面和官方当前文档核验，不按旧API Center流程盲目申请。
2. 用户于2026-11-12批准Google改用账户原生GMT−04:00日界线；Meta仍为固定EST（UTC−5）。Google真实customer.time_zone须在所选每一天均为GMT−04:00，否则返回timezone_mismatch，不能假设账户时区已核实。两平台日期边界相差1小时，跨平台合计保持null。Google缓存使用独立v4/gmt-04路径并核对时区和日期，不复用旧EST快照；默认日期按Google GMT−04:00生成。未重切小时、未修改广告账户时区。

官方参考（核对于2026-11-12）：
- https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- https://developers.google.com/google-ads/api/docs/conversions/reporting
- https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py
- https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py

## Production 配置（只通过 Vercel 环境变量安全入口）

不在聊天中交原文，不写Git，不复制到预览环境。已有Shopify/Gmail凭证不复用。

Meta：
- `META_SYSTEM_USER_TOKEN`：管理员配置两个账户的ads_read读取授权，实际有效期以Meta生成界面为准。
- `META_AD_ACCOUNT_IDS=810672167888307,1559163378893343`
- `META_GRAPH_API_VERSION`：明确填写该Meta App支持的固定版本（格式vNN.0），不依赖自动最新版本。当前未配置，mock测试版本v23.0不代表已验证该App版本。

Google（权限批准后）：
- `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID=2670021803`
- `GOOGLE_ADS_API_VERSION`：明确指定批准项目支持的版本（格式vNN；按当前官方文档编写的查询字段需实际GAQL验证）。
- `GOOGLE_ADS_ACCESS_APPROVED=true`：真实账户读取权限批准后再设，不提前设。
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`：仅通过MCC访问时配置真实10位经理ID；不确定留空。
- `GOOGLE_ADS_PURCHASE_ACTION_IDS`：人工核实后的购买action数字ID，多个逗号分隔，禁止把页面浏览/加购action加入。
- 本实现不要求或发送旧`GOOGLE_ADS_DEVELOPER_TOKEN`。OAuth scope adwords授权本身不是平台细分的“只读scope”；本代码只实现search和必要OAuth刷新，不实现mutate。

凭证变更后重新部署Production，或按项目正常发布流程让运行实例获取新配置。

## 验证方操作与验收

1. 先审PR，当前Production未自动切到此代码。预览环境无Production凭证，不能通过预览页面数字宣称API接通。
2. 发布获准版本并配置Meta后，带内部BI bearer访问`GET /api/bi-ads-config`，只返回配置存在性，不返密钥。
3. 调`GET /api/bi-ops-dashboard?start=2026-11-10&end=2026-11-10&refresh=1`，检查Shopify、`ads.meta`、`ads.google`分别的来源、时间、状态。Google未批显示pending且null。
4. Meta 11/10与Ads Manager同日期/归因口径对账±0.05USD；11/09保留真实API金额，与944.45日报参考、953.89历史后台结算值的差异记录在回报中，不硬凑。两主账户必须都通过，不能把单账户部分和当总和。
5. 用隔离测试环境mock错误，不改Production token。检查Meta失败仍保留同日期最近成功值，Google和Shopify继续保存；无旧快照时null。现有`tests/kbi-ads-api.test.js`已覆盖此逻辑，但不替代真实平台对账。
6. Google批准后，访问`GET /api/bi-ads-config?google_actions=1`读真实客户时区/货币/购买action。核实后设置购买ID，刷新并核对11/10花费25.24USD±0.05、购物购买0。用户确认基准来源为2026-11-10可视化日报快照（asOf 2026-11-11T15:16:07Z），Google Ads后台Kailash Energy01-1（267-002-1803）单日实查，已写入Midas表11-10行；另含加购1、发起结账0。此为用户提供的基准说明，本轮尚未读取原始快照或Midas表，不能视为复核证据。当前Google适配器只读取购买action，未读取的加购/结账返回null，其1/0基准需单独平台证据验收，不能填0冒充实测。互动日期、转化日期购买分别验收，不以“全部转化”替代。
7. 若时区不匹配，不能把该项验收写成通过；先记录实际时区并决定规范化方案。
8. 前端核对Meta/Google/合计三行；展开测试点看广告组、广告、创建时间和链接；API原始details保留全部已拉行，界面最多展示200行。核对每个平台日期口径标签，以及边界不同情况下合计为空。
9. 验证全程仅GET配置、GET运营数据；上游Meta仅GET，Google仅OAuth刷新与googleAds:search，不创建广告。

## 交付状态

代码与mock测试完成；2026-11-12已核实BI项目的META_SYSTEM_USER_TOKEN与META_AD_ACCOUNT_IDS仅配置在Production，未读取其值。仍缺META_GRAPH_API_VERSION、Google专用Production配置、Google项目权限批准、购买action人工确认及真实账户时区核验。任务单第6节全文已由用户提供并记录于docs/bi-ads-acceptance.md；用户指定主聊为Muse交接位置，真实对账未执行；所有业务验收与最终切换由验证方执行。

## 任务单与Muse交接
用户已提供任务单第6节全文，完整验收标准及本聊天已批准调整见 [bi-ads-acceptance.md](bi-ads-acceptance.md)。用户指定当前主聊作为Muse交接位置，无需另找侧边聊；尚无Muse已执行或验收通过的证据。原指定文件路径为 workspace/goals/kailash-energy/files/bi-meta-google-api/TASK_FOR_CODEX.md，本机未发现该路径，本文以用户直接提供的第6节为依据。
