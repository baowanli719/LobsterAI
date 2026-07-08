---
name: report-builder
description: >-
  由结构化数据本地生成 Word (.docx) 报告：标题/元信息、文字段落与要点、数据表格、
  柱状图/折线图/饼图，可套用固定公司模板（页眉页脚/样式）。当用户要「生成报告」
  「做一份月报/周报/日报」「导出 Word 报告」「把这些数据做成带图表的报告」
  「业务报告/数据报告/分析报告」时使用。全部在本地生成，不连云端。
  Generate Word (.docx) reports locally from structured data: headings, paragraphs,
  bullet lists, data tables, and bar/line/pie charts, with an optional company template.
official: true
---

# 报告生成（report-builder）

把结构化内容生成一份排版好的 Word 报告，**完全本地、不联网**。文字与表格用
`python-docx`，图表用 `matplotlib`（离线渲染），可套用固定的公司 Word 模板。

## 用法

**始终用 `$SKILLS_ROOT` 定位脚本。** 先把报告内容整理成一个 JSON 文件，再运行：

```bash
python "$SKILLS_ROOT/report-builder/scripts/build_report.py" <spec.json> <输出.docx>
# 套用公司模板（模板需含页眉页脚/样式，正文留空）：
python "$SKILLS_ROOT/report-builder/scripts/build_report.py" <spec.json> <输出.docx> --template <模板.docx>
```

生成后把 `.docx` 路径告诉用户，或用附件形式交付。

## spec.json 结构

除 `title` 外均可选；`sections` 按顺序渲染。

```json
{
  "title": "2026年6月经纪业务月报",
  "subtitle": "内部报告 · 谨慎传阅",
  "meta": {"作者": "数据团队", "日期": "2026-06-30", "部门": "经纪业务部"},
  "sections": [
    {"heading": "业务概览",
     "paragraphs": ["第一段...", "第二段..."],
     "bullets": ["要点一", "要点二"]},

    {"heading": "分营业部明细",
     "table": {"columns": ["营业部", "新增客户", "佣金(万元)"],
                "rows": [["深圳分公司", 320, 45.2], ["北京分公司", 280, 39.1]]}},

    {"heading": "近6月趋势",
     "chart": {"type": "bar", "title": "近6月新增客户",
                "labels": ["1月","2月","3月","4月","5月","6月"],
                "series": [{"name": "新增客户", "data": [800,900,850,1000,1100,1200]}]}}
  ]
}
```

### 字段说明
- `title` / `subtitle` / `meta`：封面标题、副标题、居中的元信息（键值对，如作者/日期/部门）。
- 每个 section 可同时含 `heading`、`paragraphs`（段落数组）、`bullets`（要点列表）、
  `table`、`chart`，按此顺序渲染；不需要的字段省略即可。
- `table.columns` 表头 + `table.rows` 二维数组（每行长度与列数对齐，缺的留空）。
- `chart.type`：`bar`（柱状，支持多 series 分组）/ `line`（折线，支持多 series）/
  `pie`（饼图，取第一个 series）。`labels` 为横轴/扇区标签，
  `series` 为 `[{"name": "系列名", "data": [数值...]}]`。图表标题用 `chart.title`。

## 模板

- 不传 `--template` 时用内置简易样式（右上角「内部报告 · 谨慎传阅」页眉）。
- 传 `--template 公司模板.docx` 可套用固定版式：模板里预设好页眉页脚、logo、
  标题样式即可，脚本在其基础上追加正文。若要做公司统一模板，先做一个正文为空、
  只含页眉页脚/样式的 `.docx` 作为模板传入。

## 注意
- 图表中文已配置 微软雅黑/黑体 字体，正常显示不乱码。
- 一切在本地完成，不发送任何数据到外部服务。
- 若环境缺 `matplotlib`，图表会被跳过并在 stderr 提示，文字与表格仍正常生成。
