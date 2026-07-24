# Rich Report / 盛写作 Style Guide

## Positioning

Create Chinese writing-focused DOCX reports that combine clear narrative, structured analysis, tables, and matplotlib charts. The output should feel like a professional report: dense enough for decision-making, but not visually noisy.

## Default Structure

Use this structure unless the user specifies another one:

1. 标题: specific topic, company, industry, or question.
2. 副标题: optional, use it for period, scope, or scenario.
3. 核心观点: 3-5 conclusion-first bullets.
4. 正文分析: organize by logic, not by data availability.
5. 图表: place each table or figure near the paragraph that uses it.
6. 风险提示 / 局限说明: required for investment, forecast, policy, or strategy reports.

## Chinese Writing

- Use conclusion-first wording: "我们认为/核心判断是..." only when there is support.
- Prefer short paragraphs of 3-6 sentences.
- Use Microsoft YaHei throughout DOCX reports.
- Indent normal body paragraphs by two Chinese characters on the first line.
- Separate fact, inference, and recommendation.
- Give dates for time-sensitive data.
- Avoid vague intensifiers such as "显著", "明显", or "大幅" unless the report defines the comparison baseline.
- Do not invent source data. If data is missing, state the assumption or limitation.

## Tables

- Use tables for exact values, rankings, segment comparison, and scenario matrices.
- Keep column count moderate. If a table is too wide for a Word page, split it or move detail to an appendix.
- Put units in the table title or column name: `收入（亿元）`, `同比（%）`.
- Right-align numeric values when possible.
- Include source notes below important tables.
- Use concise table titles: `表1：重点公司估值对比`.

## Charts

Prefer matplotlib and export PNG at 200-300 dpi. Use Microsoft YaHei as the chart font.

- Line chart: time series, trend comparison.
- Bar chart: categorical comparison.
- Horizontal bar chart: rankings or long category names.
- Stacked bar or area: structure and mix change.
- Scatter chart: relationship or distribution.

Chart requirements:

- Use readable Chinese font such as Microsoft YaHei or SimHei when available.
- Include chart title, axis labels, unit, legend when multiple series exist, and source note.
- Use restrained colors with enough contrast. Avoid decorative gradients and unnecessary 3D effects.
- Start bar chart axes at zero unless there is a documented reason.
- Use dual axes only when necessary; label both axes clearly.
- Check exported PNGs for non-empty content before inserting them into DOCX.

## DOCX Layout

- Use A4 or default Word page size unless the user requests another layout.
- Keep margins professional and readable.
- Use title, subtitle, Heading 1, Heading 2, Normal, caption, and source-note styles consistently.
- Use Microsoft YaHei for all DOCX text.
- Apply a two-Chinese-character first-line indent to normal body paragraphs only.
- Place captions below images and source notes below captions or tables.
- Keep images within page width.
- Avoid page-breaking a chart far away from its explanation.

## Final Checks

Before delivering:

- Confirm the `.docx` file exists and is not tiny.
- Confirm every referenced image exists.
- Confirm chart files are not blank or corrupt.
- Confirm tables have headers and reasonable column widths.
- Confirm all figure/table source notes are present when data is sourced.
- Mention any data assumptions or missing source limitations in the final response.
