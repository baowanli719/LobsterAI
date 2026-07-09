---
name: rich-report
version: "1.1.0"
description: Create polished Chinese writing-focused DOCX reports with structured arguments, research-report-style prose, formatted tables, matplotlib charts, captions, data-source notes, and layout checks. Use when the user asks for 盛写作, rich-report, 图文并茂写作, 研报式写作, professional Word reports, financial research notes, or analytical DOCX documents containing narrative, tables, and images.
---

# Rich Report

## Overview

Use this skill as a dedicated Chinese writing workflow for polished DOCX reports. Produce documents that combine strong narrative structure, conclusion-first analysis, clean tables, matplotlib-generated charts, captions, source notes, unified Microsoft YaHei typography, and a final layout check.

Default to `.docx` as the deliverable unless the user explicitly requests another format. Use `matplotlib` for generated charts and `python-docx` for assembling the Word document. If the system Python lacks document or plotting packages, use the Codex bundled Python runtime when available.

## Workflow

1. Clarify the writing objective, audience, required output path, source material, data sources, and whether the user wants a concise note or a full report. If the request is clear, proceed without asking.
2. Read `references/report-style-guide.md` before drafting a substantial report, choosing chart types, or setting table/chart conventions.
3. Convert user material into a clear argument: define the core claim, supporting logic, evidence, and implications before writing.
4. Prepare or normalize source data with structured tools such as pandas. Keep raw assumptions visible in the report notes when data is incomplete.
5. Generate charts with `scripts/make_chart.py` when chart data is tabular, or use `scripts/report_style.py` directly for custom matplotlib figures.
6. Create a report specification JSON and assemble the DOCX with `scripts/build_docx_report.py`.
7. Verify the output: confirm the DOCX exists, file size is non-trivial, images are present, table columns fit, and chart PNGs are not blank.

## Writing Structure

Prefer this structure for analytical writing:

- Title, subtitle, date, author or source context
- 核心观点: 3-5 conclusion-first bullets
- 正文分析: organize sections by logic, not by available material order
- 图表说明: every table and figure needs a title, unit where relevant, and source note
- 风险提示 or 局限说明: include when the report supports an investment, business, strategy, or policy decision
- Typography: use Microsoft YaHei throughout the DOCX; indent body paragraphs by two Chinese characters on the first line

## Scripts

Use `scripts/make_chart.py` for common chart generation:

```bash
python scripts/make_chart.py --input data.csv --output chart.png --chart-type line --x 日期 --y 收入 利润 --title "收入与利润趋势" --source "Wind, 公司公告"
```

Supported chart types: `line`, `bar`, `hbar`, `stacked-bar`, `area`, and `scatter`.

Use `scripts/build_docx_report.py` to assemble a DOCX from a JSON spec:

```bash
python scripts/build_docx_report.py --spec report_spec.json --output report.docx
```

The spec supports:

- `title`, `subtitle`, `author`, `date`, `source`
- `summary`: list of bullet points
- `sections`: list of objects with `heading`, `paragraphs`, `tables`, and `images`
- `risk_warnings`: list of risk or limitation bullets

## Quality Bar

- Write in Chinese by default for Chinese user requests.
- Use Microsoft YaHei for DOCX text and matplotlib charts.
- Indent every normal body paragraph by two Chinese characters on the first line. Do not apply this indent to titles, headings, bullets, captions, source notes, or table cells.
- Use conclusion-first paragraphs: state the claim, then support it with data or reasoning.
- Use tables for precise comparison and charts for trend, structure, distribution, or correlation.
- Never insert an unlabeled chart or table.
- Prefer restrained professional report styling over decorative layouts.
- For charts, include readable Chinese fonts, units, legends, gridlines where useful, and source notes.
- Before delivery, open or inspect generated artifacts enough to catch missing images, empty charts, and broken paths.
