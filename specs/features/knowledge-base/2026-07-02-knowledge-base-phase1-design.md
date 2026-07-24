# 知识库（Knowledge Base）第一期设计文档

## 1. 概述

### 1.1 问题/背景

用户有大量个人常用的知识资料（FAQ、内部规范、排错手册等），希望沉淀下来并在任意工作区项目的对话中"无感"生效。现状：

1. 设置里的"记忆管理"只管理 `MEMORY.md` 的单行 bullet 条目，每次会话全量注入，不适合承载成篇文档（token 成本高，且 `parseMemoryMd` 只识别 bullet 行，多行文档会被解析丢弃）。
2. OpenClaw 的记忆索引（`memory_search` 向量 + FTS 混合检索）已支持按需检索，但入口只有 `workspace-main/MEMORY.md` 和 `workspace-main/memory/` 目录，没有面向用户的文档管理界面。
3. `memory/` 目录同时被 Dreaming、短期记忆晋升等自动流程读写，用户文档直接放进去有被自动整理流程误处理的风险。

因此需要一个独立的"知识库"能力：用户在专家套件页面创建多个知识库、导入文档，文档由引擎全局索引，并可在对话中显式引用聚焦。

### 1.2 目标

1. 专家套件（Kits）页面新增"知识库"入口，点击进入知识库管理界面。
2. 用户可创建多个知识库（命名、重命名、删除），向知识库导入 `.md` / `.txt` 文档，查看、预览、删除文档。
3. 知识库文件落在独立目录（不在 `memory/` 生命周期内），通过 `agents.defaults.memorySearch.extraPaths` 接入 OpenClaw 记忆索引，全局可检索。
4. 对话输入区支持引用知识库：引用后当轮注入 `<selected_knowledge_bases>` 上下文块，引导 Agent 优先检索该知识库（复用套件选中注入模式）。
5. Embedding 未开启时给出引导提示，并保证引用仍可降级工作（Agent 直接读取知识库文件）。

### 1.3 非目标

- 不做 docx/pdf 等富格式的自动转换导入（后续迭代）。
- 不启用 `memory-wiki` 插件，不做 URL 抓取导入、溯源（provenance）、引用健康度（第二期方向，本期不做）。
- 不做按会话的硬隔离：`memory_search` 工具参数（`query`/`maxResults`/`minScore`/`corpus`）不支持按路径过滤，memorySearch 又是全局配置，改动会触发网关重启。产品语义定义为"全局索引 + 会话内聚焦引用"。
- 不改变现有 MEMORY.md 记忆管理的定位（短事实、每会话常驻），两者互补。
- 不做知识库的云同步/分享，全部数据本地私有。

## 2. 用户场景

### 场景 1: 创建知识库并导入文档

**Given** 用户打开专家套件页面
**When** 点击"知识库"入口 → 新建知识库"前端规范" → 导入若干 `.md` 文档
**Then** 知识库列表显示"前端规范"及文档数量；文件落盘到 `{STATE_DIR}/knowledge-bases/<kbId>/`；索引器在下次检索同步时自动纳入，无需重启网关。

### 场景 2: 对话中引用知识库

**Given** 用户已创建知识库"前端规范"，Embedding 已开启
**When** 在对话输入区通过套件弹窗选中"前端规范"，发送问题
**Then** 当轮消息附带 `<selected_knowledge_bases>` 上下文块；Agent 调用 `memory_search` 检索，优先采信 path 位于该知识库目录下的命中结果作答。

### 场景 3: 不引用时的无感检索

**Given** 知识库已创建且 Embedding 已开启
**When** 用户在任意工作区项目提问，未显式引用知识库
**Then** Agent 通过 `memory_search` 仍能检索到知识库内容（extraPaths 全局索引），实现无感注入。

### 场景 4: Embedding 未开启

**Given** 用户未开启 Embedding（`coworkConfig.embeddingEnabled` 为 false）
**When** 进入知识库管理页
**Then** 页面顶部显示引导横幅（跳转到 设置 → 记忆 → Embedding）；对话中引用知识库时注入块仍包含知识库的绝对路径，提示 Agent 可直接读取目录下文件，功能降级但可用。

### 场景 5: 删除知识库

**Given** 知识库"前端规范"存在且包含文档
**When** 用户删除该知识库并确认
**Then** 整个 `{STATE_DIR}/knowledge-bases/<kbId>/` 目录被删除；索引同步后检索不再命中；若该知识库正被会话引用，引用 chip 同步移除。

## 3. 总体设计

### 3.1 存储布局

```text
{STATE_DIR}/knowledge-bases/          ← 知识库根目录（固定，接入 extraPaths）
  <kbId>/                             ← 每个知识库一个目录，kbId 为 UUID
    kb.json                           ← 元数据（非 .md，索引器天然忽略）
    <doc-slug>.md                     ← 导入的文档（统一转为 .md 落盘）
    ...
```

`kb.json` 结构：

```json
{
  "id": "<uuid>",
  "name": "前端规范",
  "createdAt": 1751414400000,
  "updatedAt": 1751414400000
}
```

选择 `{STATE_DIR}/knowledge-bases/` 而不是 `workspace-main/memory/` 子目录的原因：

1. `memory/` 被 memory-core 的 Dreaming、短期记忆晋升流程读写，用户文档放入有被自动整理误处理的风险。
2. OpenClaw 配置 schema 正式支持 `agents.defaults.memorySearch.extraPaths`（额外索引路径），索引器 `listMemoryFiles` 会递归收集 extraPaths 下所有 `.md` 文件（跳过符号链接和非 .md 文件）。
3. 根目录固定意味着 openclaw.json 配置一次写入后不再变化——增删知识库、增删文档都只是文件系统操作，不触发配置同步和网关重启。

### 3.2 索引接线（openclawConfigSync）

在 `src/main/libs/openclawConfigSync.ts` 的 `memorySearch` 配置块（`agents.defaults.memorySearch`，现有代码约 1540 行处）内追加：

```ts
...(coworkConfig.embeddingEnabled ? {
  memorySearch: {
    enabled: true,
    // ... 现有 provider/store/query 配置不变 ...
    extraPaths: [path.join(this.engineManager.getStateDir(), 'knowledge-bases')],
  },
} : {}),
```

要点：

- 路径固定，配置稳定，属于 openclawConfigImpact 分类中的低影响变更（仅首次启用时写入一次）。
- 仅在 `embeddingEnabled` 时生效，与现有 memorySearch 开关一致。
- 应用启动时由主进程确保 `knowledge-bases/` 根目录存在（`ensureDir`），避免索引器扫描不存在的路径。

### 3.3 对话引用注入

完全复用"选中套件"链路（`CoworkPromptInput.handleSubmit` → `buildSelectedKitContextPrompt` → 随消息注入）：

1. 新增 `src/renderer/components/cowork/selectedKnowledgeBaseContextPrompt.ts`，导出 `buildSelectedKnowledgeBaseContextPrompt(kbIds, knowledgeBases)`，生成：

```text
## Referenced knowledge bases for this turn
The user referenced these private knowledge bases. Prefer them when answering.
<selected_knowledge_bases>
  <knowledgeBase>
    <name>前端规范</name>
    <path>C:\...\knowledge-bases\<kbId></path>
    <docs count="12" />
  </knowledgeBase>
</selected_knowledge_bases>
Retrieval: call `memory_search` with terms from the user's question; prefer results whose `path` is under a referenced knowledge base directory. If memory search is unavailable, read files under the directory directly.
```

2. 在 `CoworkPromptInput.handleSubmit` 现有的 prompt 组装处（`kitPrompt` 与 `buildSelectedSkillRoutingPrompt` 合并处）加入 kbPrompt，三段 `filter(Boolean).join('\n\n')`。
3. XML 转义、长度截断等工具函数与 `selectedKitContextPrompt.ts` 保持同款实现。

### 3.4 引用交互（UI）

- **选择入口**：`KitsPopover` 内新增"知识库"分组，列出全部知识库（含文档数），点击切换选中态；与已装套件列表并列展示，超过阈值时纳入现有搜索框过滤。
- **选中态展示**：复用 `ActiveKitBadge` 模式，在输入框上方显示知识库 chip（图标区分套件/知识库），可单个移除。
- **选中状态存储**：新增 `knowledgeBaseSlice`（`knowledgeBases: KnowledgeBaseSummary[]`, `activeKbIds: string[]`）。实现说明：与 `activeKitIds`（按会话草稿持久化、切换会话时重置）不同，`activeKbIds` 为全局状态——引用的知识库在用户移除 chip 前对所有会话持续生效。这更贴合"引用知识库"的语义（资料引用不随会话切换失效），也避免了向 coworkSlice 草稿机制扩散改动；如后续需要按会话隔离，可仿照 `draftKitIds` 补充。

## 4. 详细设计

### 4.1 主进程：knowledgeBaseManager

新增 `src/main/libs/knowledgeBaseManager.ts`（文件 I/O 风格照 `openclawMemoryFile.ts`）：

```ts
export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  docCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBaseDoc {
  fileName: string;   // 落盘后的 .md 文件名
  size: number;
  updatedAt: number;
}

export function getKnowledgeBasesRoot(stateDir: string): string;        // {stateDir}/knowledge-bases
export function listKnowledgeBases(root: string): KnowledgeBaseSummary[];
export function createKnowledgeBase(root: string, name: string): KnowledgeBaseSummary;
export function renameKnowledgeBase(root: string, id: string, name: string): KnowledgeBaseSummary;
export function deleteKnowledgeBase(root: string, id: string): boolean;
export function listDocs(root: string, id: string): KnowledgeBaseDoc[];
export function importDocs(root: string, id: string, filePaths: string[]): ImportResult[];
export function readDoc(root: string, id: string, fileName: string): string;
export function deleteDoc(root: string, id: string, fileName: string): boolean;
```

实现约束：

- **导入**：仅接受 `.md` / `.txt`；`.txt` 内容原样落盘为同名 `.md`。文件名 slug 化（去除路径分隔符与保留字符），同名冲突追加 `-1`/`-2` 后缀。单文件上限 5 MB，超限返回带原因的失败项，不中断整批导入。
- **路径安全**：所有对 `id`/`fileName` 的操作先 `path.resolve` 后校验仍位于知识库根目录内（防目录穿越）；`fileName` 拒绝包含 `/` `\` `..`。
- **删除**：`deleteKnowledgeBase` 使用 `fs.rmSync(dir, { recursive: true })`，仅当 `kb.json` 存在且可解析时才允许（防误删非知识库目录）。
- **名称**：知识库名去首尾空白、限长 64 字符、同名允许（以 id 区分）。

### 4.2 IPC 与 preload

`src/main/main.ts` 注册 handler（命名沿用 `cowork:memory:*` 风格）：

| Channel | 参数 | 返回 |
| --- | --- | --- |
| `cowork:kb:list` | – | `KnowledgeBaseSummary[]` |
| `cowork:kb:create` | `{ name }` | `KnowledgeBaseSummary` |
| `cowork:kb:rename` | `{ id, name }` | `KnowledgeBaseSummary` |
| `cowork:kb:delete` | `{ id }` | `boolean` |
| `cowork:kb:listDocs` | `{ id }` | `KnowledgeBaseDoc[]` |
| `cowork:kb:importDocs` | `{ id, filePaths }` | `ImportResult[]` |
| `cowork:kb:readDoc` | `{ id, fileName }` | `string` |
| `cowork:kb:deleteDoc` | `{ id, fileName }` | `boolean` |
| `cowork:kb:pickDocs` | – | `string[]`（`dialog.showOpenDialog`，过滤 md/txt） |

`preload.ts` 暴露对应方法；渲染进程新增 `src/renderer/services/knowledgeBase.ts` 封装。

### 4.3 渲染进程 UI

**入口（侧边栏一级菜单）**：知识库作为左侧一级菜单项，位于"专家套件"之后、"技能"之前（按用户要求与专家套件平级，替代最初"套件页内区块卡片"的方案）。`App.tsx` 的 `mainView` 联合类型扩展 `'knowledgeBase'`，新增 `KnowledgeBaseView`（标题栏结构与 `KitsView` 一致），内容复用 `KnowledgeBaseManager`（`onBack` 可选，一级视图模式下不显示返回键）。

**管理视图**：新增 `src/renderer/components/kits/KnowledgeBaseManager.tsx`：

- 左侧知识库列表（新建、重命名、删除，删除需 `Modal` 二次确认并提示文档数）。
- 右侧选中知识库的文档列表（导入按钮走 `cowork:kb:pickDocs`，支持拖拽文件进区域；每行显示文件名/大小/更新时间，操作：预览、删除）。
- 预览用只读 `Modal` 展示 markdown 原文（第一期不做富渲染）。
- Embedding 未开启时顶部显示警示横幅，文案链接到 设置 → 记忆 → Embedding 子页。
- 空态复用 `ExpertKitsEmptyIcon` 风格新增插图或纯文案。

**对话引用**：见 3.4。

### 4.4 i18n

`src/renderer/services/i18n.ts` 增加中英文案（节选）：`knowledgeBase`（知识库）、`kbCreate`、`kbRename`、`kbDelete`、`kbDeleteConfirm`、`kbImportDocs`、`kbDocCount`、`kbEmbeddingDisabledHint`、`kbImportFailedTooLarge`、`kbImportFailedUnsupported` 等。

## 5. 边界与降级

| 情况 | 行为 |
| --- | --- |
| Embedding 未开启 | memorySearch 仍开启，memory-core 进入 FTS-only 模式（BM25 关键词检索 + trigram 中文分词，零外部依赖）；开启 Embedding 后自动升级为向量+关键词混合检索；管理页显示检索模式提示 |
| 知识库为空 | 可被引用，注入块 `docs count="0"`，无实际影响 |
| 导入非 md/txt | 单文件失败并提示，不中断整批 |
| 文档含中文 | 现有 `fts: { tokenizer: 'trigram' }` 已覆盖中文分词，无需额外处理 |
| 引用的知识库被删除 | `activeKbIds` 在发送前与最新列表求交集，失效 id 静默剔除 |
| 多窗口/并发写 | 第一期不做锁；所有写操作单文件原子（writeFileSync），kb.json 冲突以后写覆盖为准 |

## 6. 测试

1. `knowledgeBaseManager` 单元测试（Node test runner，仿 `tests/openclawMemoryFile.test.mjs`）：创建/重命名/删除、导入 slug 化与冲突后缀、txt→md、路径穿越拒绝、大小超限、删除保护（无 kb.json 不删）。
2. `selectedKnowledgeBaseContextPrompt` 单元测试（仿 `selectedKitContextPrompt.test.ts`）：空选择返回 undefined、XML 转义、多知识库拼装。
3. `openclawConfigSync` 的 extraPaths 接线：现有测试套件未覆盖 memorySearch 配置块（该类依赖 engineManager，无现成测试挂点），本期以 TypeScript 编译 + 既有 runtime 测试回归验证，不单独补配置断言。
4. 手工验收：按第 2 节场景 1–5 逐条走查（含真实 embedding 检索命中知识库文档）。

## 7. 实施拆分

1. 主进程：`knowledgeBaseManager.ts` + IPC + preload + `openclawConfigSync` extraPaths 接线 + 启动时 ensureDir。
2. 渲染进程：`knowledgeBaseSlice` + `services/knowledgeBase.ts` + `KnowledgeBaseManager.tsx` + `KitsManager` 入口卡片。
3. 对话引用：`KitsPopover` 知识库分组 + chip 展示 + `selectedKnowledgeBaseContextPrompt.ts` + `CoworkPromptInput` 组装点。
4. i18n 文案 + 单元测试 + 手工验收。
