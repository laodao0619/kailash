# Kailash Energy CRM 2.0｜Shopify Customers 有效性、订阅分层与飞书字段整理

批准口径：2026-11-08。只改飞书 CRM 两张既有业务表，不更改 Shopify 的 Customers、订单和商品，也不更改独立产品资产库。

## 1. 数据来源

Shopify Admin API `customers`（所有历史 Customers，非订单查询结果）：

- 主键：`Customer.id` Shopify GID；飞书主列显示数字 ID。
- 客户信息：firstName、lastName、defaultEmailAddress.emailAddress、defaultAddress.country、numberOfOrders、amountSpent、lastOrder.processedAt。
- 邮件订阅：`defaultEmailAddress.marketingState`，禁止使用“是否下过单”或“收过邮件”推断。
- 订阅分层：SUBSCRIBED=已订阅；NOT_SUBSCRIBED=未订阅；UNSUBSCRIBED=已退订；PENDING=待确认；INVALID=邮箱无效并排除。
- 未订阅/已退订的客户可以保留用于客服与RFM，但**绝不能因此自动发送营销邮件**。

## 2. 客户有效性规则

不会删除 Shopify 源客户。对飞书 CRM 客户档案执行：

- 排除 QQ 邮箱（qq.com、qq.com.cn）、明确的假/临时邮箱（fakemail、mailinator、yopmail、example 等）。
- 排除 Google StoreBot、demo、test、dummy、fake 等机器人/测试用户，数字占位名及显著测试邮箱。
- 排除空邮箱和 Shopify 标记邮箱格式无效的记录。
- 排除“没有订单、不是 SUBSCRIBED、又没有姓名”的匿名占位资料。
- 如果可疑账户曾有订单，仍排除在对员工开放的正式 CRM 外，但单独累计有订单的待核验排除数，供人工分析，不把它当作未购买客户。
- 不根据国家、语言、文化偏好或私人身份属性进行客户排除。
- **Shopify Customer 总数 ≠ CRM 有效人数**，两者都需要在执行报告中列出。

## 3. 历史资料治理

已经进入飞书的假账户，经上述规则复核后清理飞书副本。清理操作不影响 Shopify。以 Shopify 客户 ID 去重，先创建字段及简化视图，再按游标分批重新核对之前导入的全部客户。

任务记录包括：Shopify 来源总量、扫描量、有效新增/更新、已订阅、非订阅、排除总数、QQ 排除、机器人/虚假邮箱排除、可疑有订单数、清理旧记录数、下一页游标。

客户 RFM 需要完整180天有效订单的退款和取消口径；未获 `read_all_orders` 权限前不能计算完整 M/R/F。

## 4. 飞书字段与视觉结构

维持**只有两张业务表**。客户档案内按以下工作模块整理（图示的“列分组”为飞书前端功能）：

1. 客户个人信息：客户姓名、邮箱、国家地区、Shopify客户ID。
2. 订阅与数据质量：邮件订阅状态、客户数据状态。
3. 客户价值与RFM：CRM等级、近180天净消费、最近下单日期、近180天有效订单数、历史消费、历史订单数、客单价分组、R。
4. 用户心理与客户旅程：客户旅程阶段、RFM价值分群、用户心理与购买动机、偏好主题与图腾、关系风险、用户画像摘要。
5. 运营维护：负责人、客户状态、WhatsApp、上次维护、建议下次维护、推荐维护动作、客户备注及同步时间。

此外，保留五个运营角色对应的视图中的字段选择，不需要五张业务表。新增：
- 01｜客户工作台：10个最常用字段。
- 02｜已订阅客户：真实 Shopify SUBSCRIBED。
- 03｜非订阅客户：NOT_SUBSCRIBED、UNSUBSCRIBED、PENDING。
- CRM价值分析/客户旅程总览：维持独立专题视图；本次不覆盖已有自定义设置。

提醒：飞书开放 API 可创建、筛选、隐藏字段以缩短视图，但图3样式的**可折叠“列分组”标题**仍要在飞书前端完成，这部分不能用可公开验证的API虚报已完成。

## 5. Gmail 与营销安全

Gmail 只导入近一年内（365日）与有效 Shopify Customer 唯一匹配的人工来信，一条 Gmail 线程只建立一条沟通记录。排除 Spam、Trash、Promotions、Social、Forums、邮件列表、自动回复、退信和 no-reply 等系统发信人。用户已退订不影响售后问题记录，但禁止营销自动触达。
