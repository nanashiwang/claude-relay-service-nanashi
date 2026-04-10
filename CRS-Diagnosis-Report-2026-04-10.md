# CRS 实例 (192.3.179.236) 完整诊断报告

**诊断时间**: 2026-04-10 14:00+  
**CRS 版本**: 1.2.35  
**实例地址**: 192.3.179.236:3000 (crs-ccmx.meta-api.vip)  
**上游 new-api**: 104.168.114.150 (nan.meta-api.vip)

---

## 一、当前状态概览

| 组件 | 状态 | 备注 |
|------|------|------|
| CRS v1.2.35 | 运行正常 | uptime ~28h, 内存 47MB |
| Redis | 健康 | 延迟 1ms |
| Claude 账户 8ddf (ShubeckKemerling) | **active** | 5h利用率 12-13%, 7d利用率 10% |
| Claude 账户 1dfd (RameshBuening) | **active** | 7d利用率 18% |
| OpenAI 账户 97c5 (NicholasRuiz) | **active** | codex 5h利用率 13%, 7d利用率 16% |
| OpenAI 账户 a4fd (NicholasRuiz) | **已删除** | index 残留，数据已不存在 |

### 今日错误统计

| 错误类型 | 数量 | 说明 |
|----------|------|------|
| "No available accounts" | 368 次 | Claude + OpenAI 账户不可用 |
| 500 错误响应 | 25 次 | 由账户不可用引起 |
| WRONGTYPE Redis 错误 | 若干 | usage index key 类型不匹配 |
| 429 上游限流 | 2 次 | 08:51 两个 Claude 账户同时触发 |

---

## 二、问题一：Claude 账号 97% 额度未用却显示限流

### 时间线

```
08:51:40  Claude 账户 1dfdc29e (RameshBuening) 收到 Anthropic 429
          → CRS 标记为限流，限流时间 = 会话窗口剩余 129 分钟
          → 删除粘性会话映射

08:51:42  Claude 账户 8ddfbf45 (ShubeckKemerling) 收到 Anthropic 429
          → CRS 标记为限流，限流时间 = 会话窗口剩余 249 分钟
          → 删除粘性会话映射

08:51:52  后续 Claude 请求开始报错:
          "No available Claude accounts support the requested model: claude-haiku-4-5-20251001"
          "No available Claude accounts support the requested model: claude-sonnet-4-6"
          "No available Claude accounts support the requested model: claude-opus-4-6"

08:52:32  账户 1dfdc29e 被标记为 not schedulable
          → "Mapped account 1dfdc29e is no longer available, selecting new account"
          → 但没有可选的新账户，全部被限流

11:08:57  账户 1dfdc29e 自动恢复 (约 2 小时 17 分钟后)
          → "Session window status: allowed"
          → "Cleared 401 error count"

14:08:56  账户 8ddfbf45 自动恢复 (约 5 小时 17 分钟后)
          → "Session window status: allowed"
          → "Cleared 401 error count"
```

### Anthropic 限流 Header 分析

恢复后的请求中 Anthropic 返回的限流信息：

```
anthropic-ratelimit-unified-status: allowed
anthropic-ratelimit-unified-5h-status: allowed
anthropic-ratelimit-unified-5h-utilization: 0.03 → 0.13  (3%~13%)
anthropic-ratelimit-unified-7d-status: allowed
anthropic-ratelimit-unified-7d-utilization: 0.07 → 0.10  (7%~10%)
anthropic-ratelimit-unified-overage-status: rejected
anthropic-ratelimit-unified-overage-disabled-reason: org_level_disabled
```

**关键发现**: 5h 窗口利用率仅 3%~13%，远未达到限额。429 不是因为"额度用完"，而是**短时间并发请求过多**触发了 Anthropic 的瞬时 per-minute/per-request 限流。

### 根因分析

CRS 的 429 处理逻辑在 `claudeRelayService.js` 中：

1. 收到 429 后检查 `anthropic-ratelimit-unified-reset` header
2. 如果有该 header，使用其中的 reset timestamp
3. **如果没有该 header**（瞬时限流的情况），CRS 会将限流时间设置为**会话窗口剩余时间**
4. 这导致一次瞬时的并发限流，被惩罚了 129~249 分钟

**核心问题**: 瞬时并发限流 (per-minute rate limit) 和会话窗口限流 (5h window limit) 被混为一谈，惩罚时间过长。

### 影响范围

- 08:51 ~ 11:08（约 2.3 小时）: 所有 Claude 请求失败（两个账户同时限流）
- 11:08 ~ 14:08（约 3 小时）: 仅 1dfdc29e 可用，8ddfbf45 仍在限流

---

## 三、问题二：OpenAI 账号正常却显示异常

### 时间线

```
08:00:11 ~ 08:02:15  OpenAI 账户 a4fd29b0 (NicholasRuiz7205@hotmail.com) 正常工作
                      → 多次成功完成 /openai/v1/responses 请求
                      → 使用代理 socks5://207.135.192.228:45273

08:03:04  a4fd 被选中处理新请求
08:03:05  收到上游 401 Unauthorized
          → "Auth Unauthorized error detected for OpenAI account a4fd29b0 (Codex API)"
          → CRS 自动标记为 unauthorized, schedulable=false
          → 发送 Webhook 通知

08:03:05  后续所有 Pro 组请求报错:
          "No available accounts in group Pro"
          (Pro 组仅有 a4fd 一个成员，97c5 不在 Pro 组)

09:13:11 ~ 09:13:28  大量 "No available accounts in group Pro" 错误
                      (错误日志共 406 条相关记录)

10:22:32  管理员通过后台手动删除 a4fd 账户
          → "Deleted OpenAI account: a4fd29b0-a478-4044-8ea8-67ab2470ade1"
```

### Redis 数据残留问题

删除 a4fd 后的 Redis 状态：

| Redis Key | 状态 | 问题 |
|-----------|------|------|
| `openai:account:a4fd...` (Hash) | **不存在** (已删除) | 正常 |
| `openai:account:index` (Set) | **仍包含** a4fd ID | 残留 |
| `account_groups_reverse:openai:a4fd...` (Set) | **仍存在** | 残留 |
| `account_usage:*:a4fd...` (多个) | 仍存在 | 使用统计残留 |

### Pro 组当前状态

```
account_group:33f456f0  → name: "Pro", platform: "openai"
account_group_members:33f456f0  → 仅包含 97c57bf6
```

注意: **97c5 在 Pro 组中**（SISMEMBER 返回 1），但 a4fd **不在** Pro 组中（SISMEMBER 返回 0）。
这意味着 Pro 组目前有一个可用账户 97c5，但之前 a4fd 被标记为 unauthorized 导致了一段时间的完全不可用。

### 401 可能原因

- OpenAI OAuth token 过期未能自动刷新
- 代理 (socks5://207.135.192.228:45273) 连接不稳定导致 token 刷新失败
- OpenAI 端的账户状态变更

---

## 四、用户反馈的 502 和 429 分析

### 429 错误来源

用户看到的 429 有两个来源：

1. **CRS 层面**: 08:51 两个 Claude 账户同时收到 Anthropic 429，CRS 将错误透传
2. **new-api 层面**: CRS 返回 500 ("No available accounts") 后，new-api 的重试/fallback 机制可能将其转为 429 返回给用户

### 502 错误来源

CRS 自身日志中**没有真正的 502 Bad Gateway 错误**。搜索结果：

- 日志中包含 "502" 的行共 58 条，但全部是 usage 统计数据中恰好包含数字 502
- 无 ECONNREFUSED、ECONNRESET、ETIMEDOUT、socket hang up 等连接错误
- Token 刷新错误日志为空

**502 的真正来源**: 很可能是 new-api (104.168.114.150) 层面的问题：
- CRS 返回 500 "No available accounts" → new-api 转为 502 返回给用户
- 或者 new-api 到 CRS 之间的 Nginx 代理超时/断开

### 500 错误分布

今日 CRS 返回 500 的场景：

| 错误原因 | 数量 | 时间段 |
|----------|------|--------|
| No available accounts in group Pro (OpenAI) | ~368 | 08:03 起 |
| No available Claude accounts support model | ~25 | 08:51 起 |
| WRONGTYPE Redis key 类型不匹配 | 若干 | 散发 |

---

## 五、其他发现的问题

### 5.1 Redis WRONGTYPE 错误

```
ERROR: Failed to get API keys usage trend: WRONGTYPE Operation against a key holding the wrong kind of value
Command: HGETALL "usage:daily:index:2026-04-09"
Command: HGETALL "usage:hourly:index:2026-04-09:08"
```

`usage:daily:index:*` 和 `usage:hourly:index:*` 的 key 类型与代码预期不匹配，导致管理后台的使用趋势图加载失败。

### 5.2 Claude 模型支持限制

两个 Claude 账户没有设置 `supportedModels` 字段（HMGET 返回空），理论上应该支持所有模型。但在 08:51 两个账户都被限流后，调度器找不到可用账户，报 "No available Claude accounts support the requested model"。错误信息有点误导——不是模型不支持，而是没有可用账户。

### 5.3 CRS 实例作为 new-api 上游的链路

```
new-api (104.168.114.150) 
  → CRS channels (192.3.179.236:3000)
    → Anthropic API (Claude)
    → OpenAI API (Codex/Responses)
```

当 CRS 上所有账户不可用时，new-api 的 channel 测试会返回 503，导致 channel 被自动禁用。

---

## 六、修复建议

### 6.1 立即修复

#### 清理 Redis 残留数据

```bash
# 在 192.3.179.236 上执行
redis-cli SREM "openai:account:index" "a4fd29b0-a478-4044-8ea8-67ab2470ade1"
redis-cli DEL "account_groups_reverse:openai:a4fd29b0-a478-4044-8ea8-67ab2470ade1"
```

#### 重新添加 OpenAI 账户

如果 NicholasRuiz7205@hotmail.com 的 OAuth token 仍然有效，通过 CRS 管理后台重新添加。

### 6.2 代码修复（429 限流惩罚过重）

**问题位置**: `src/services/claudeRelayService.js` 和 `src/services/unifiedClaudeScheduler.js`

**建议修改**:

1. 区分瞬时限流和窗口限流：
   - 如果 429 响应包含 `anthropic-ratelimit-unified-reset` header → 使用 reset 时间
   - 如果 429 响应**不包含** reset header → 设置短时限流（5~10 分钟），而非会话窗口剩余时间

2. 避免所有账户同时被限流：
   - 增加请求间隔或并发控制
   - 考虑实现"至少保留一个账户可用"的保护策略

### 6.3 代码修复（账户删除清理不完整）

**问题位置**: `src/services/openaiResponsesAccountService.js` 的删除方法

**建议**: 删除账户时同步清理：
- `openai:account:index` 中的成员
- `account_groups_reverse:openai:{accountId}` key
- 相关的 `account_usage:*` keys

### 6.4 Redis Key 类型不匹配

检查 `usage:daily:index:*` 和 `usage:hourly:index:*` 的数据结构，可能是数据迁移或版本升级导致的类型冲突。需要清理或迁移这些 key。

---

## 七、CRS 集群状态（所有实例）

从 104.168.114.150 (new-api) 检测到的上游 CRS 实例：

| 实例 | 状态 | 版本 | 运行时间 | 备注 |
|------|------|------|----------|------|
| crs-cxfr01.meta-api.vip | 健康 | 1.2.35 | ~24 天 | |
| crs-cxfr02.meta-api.vip | **301 重定向** | - | - | HTTP 被重定向到 HTTPS |
| crs-cxfr03.meta-api.vip | 健康 | 1.2.35 | ~2.3 天 | |
| crs-cxtm01.meta-api.vip | 健康 | 1.2.35 | ~24 天 | 内存 106MB 较高 |
| crs-cxtm02.meta-api.vip | 健康 | 1.2.35 | ~24 天 | |
| crs-cxtm03.meta-api.vip | 健康 | 1.2.35 | ~24 天 | |

### new-api 中的其他异常上游

| 上游 | 问题 | 错误 |
|------|------|------|
| vip.undyingapi.com (channels 497-506) | status=3 自动禁用 | 500: upstream error: do request failed |
| api.aipaibox.com (channels 517-525) | 测试失败 | 503: No available accounts |
| 23.94.149.112:8317 (cpa-codex, channels 553-612) | status=3 自动禁用 | 500: auth_unavailable: no auth available |
| crs-cxfr03 (channels 288-322) | status=3 自动禁用 | 历史遗留 |

---

*报告结束*
