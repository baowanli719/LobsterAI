---
name: 行情播报
description: >
  投研数字员工 — 行情播报技能。
  调用 行情播报 智能体进行专业投研分析。
  Use when: 帮我分析 行情播报
compatibility: "需要投研数字员工代理服务。使用前启动 backend/start_all.py。"
metadata:
  author: 投研数字员工
  version: "1.1.0"
  skill_type: warrenq_agent
  bot_id: "273741394539648"
  package: "@wyn/skills"
---

# 行情播报

## 概述

调用 行情播报 智能体进行专业投研分析。

本技能通过「投研数字员工」代理服务调用 WarrenQ 智能体后端（bot_id: `273741394539648`）。

---

## API 配置

本技能使用环境变量配置，不硬编码任何凭证：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WYN_API_BASE` | `http://192.168.230.108/skillshub` | 投研数字员工代理服务地址 |

> 认证凭证由代理服务统一管理，技能文件中不暴露任何 `auth_code` 或 `api_key`。

---

## 前置条件

**启动代理服务**：

```bash
cd backend
python start_all.py
```

**健康检查**：

```bash
API="${WYN_API_BASE:-http://192.168.230.108/skillshub}"
curl.exe -s "$API"/api/health
# 应返回: {"status": "ok", "service": "投研助手数字员工"}
```

> ⚠️ Windows PowerShell 中 `curl` 是 `Invoke-WebRequest` 别名，必须用 `curl.exe`。  
> `${WYN_API_BASE:-...}` 是 bash 默认值语法：有环境变量则用环境变量，没有则用默认值。

---

## 触发场景

- "帮我分析 行情播报"\n

## 分析输出结构

本智能体分析结果包括以下章节：

| 分析章节 | 内容说明 |
|---|---|


---

## 调用流程

### 步骤 1：发送流式请求（推荐）

调用 **SSE 流式端点**（内部完成思考解析、action:// 过滤、引文去重，边产边出）。

**GET 方式**（短问题）：

```bash
API="${WYN_API_BASE:-http://192.168.230.108/skillshub}"
QUERY=$(python -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "用户问题")
curl.exe -N -s "${API}/api/tools/stream?skill=market_quotes&q=$QUERY"
```

**POST 方式**（长中文提问，避免 URL 长度问题；body 走文件，Windows/Linux 通用，绕开 shell 引号与编码坑）：

先把请求体写入 UTF-8 文件 `body.json`：

```json
{"skill":"market_quotes","q":"用户问题"}
```

再调用：

```bash
API="${WYN_API_BASE:-http://192.168.230.108/skillshub}"
curl.exe -N -s -X POST "${API}/api/tools/stream" \
  -H "Content-Type: application/json" \
  --data-binary "@body.json"
```

> 查看所有可用技能名：`curl.exe -s "$API"/api/tools/skills`
> 未知/已下架技能会返回 `400` 并列出可用技能，请在清单中选择合法名称。

### 步骤 2：解析 SSE 事件流

SSE 事件类型对照表：

| 事件类型 | 含义 | 处理方式 |
|---|---|---|
| `heartbeat` | 连接保活 | 忽略，等待下一个事件 |
| `thinking` | 思考开始 | 可显示"分析中…" |
| `thinking_stream` | 思考内容流 | 可选择性展示（调试验证用） |
| `thinking_end` | 思考结束 | 准备接收正式分析 |
| `assistant_stream` | 分析内容 | **核心内容**，逐段收集 |
| `assistant_end` | 分析完成 | 含 `citations` 引文数据，组装最终报告 |
| `error` | 出错 | 读取 `content` 字段并告知用户 |

每条 SSE 事件格式：`data: {"type":"...", "content":"...", ...}\n\n`

### 步骤 3：降级方案（阻塞式）

如果 SSE 流式环境不可用，使用阻塞式端点：

```bash
API="${WYN_API_BASE:-http://192.168.230.108/skillshub}"
QUERY=$(python -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "用户问题")
curl.exe -s "${API}/api/tools/daily-trend?q=$QUERY"
```

返回 JSON：`{"analysis", "citing", "thinking", "error"}`。

---

## 输出模板

调用完成后，按以下结构向用户展示分析结果：

```
## 行情播报

{将 analysis 中的 Markdown 内容直接展示给用户}

---

### 参考来源

{遍历 citing 中的引文，逐条列出：}
- [标题](URL) — info_source

---

{如果 error 非空：}
> 分析出错：{error}
```

---

## 注意事项

- **必须先启动代理服务**：`cd backend && python start_all.py`
- 提问使用中文，支持股票名称或代码
- WarrenQ 智能体响应需要 10–60 秒，流式端点可边产边出
- **不要额外写 Python 脚本解析 SSE** — 直接按事件类型对照表处理即可
- 分析结果仅供参考，不构成投资建议。投资有风险，入市需谨慎。
