#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
report-builder —— 由结构化 JSON 生成 Word (.docx) 报告。

本地生成，不连云端。文字/表格用 python-docx，图表用 matplotlib（离线 Agg 后端）。
支持套用固定 Word 模板（页眉页脚/logo/样式）。

用法:
  python build_report.py <spec.json> <output.docx> [--template <模板.docx>]

spec.json 结构（所有字段可选，除 title）：
{
  "title": "2026年6月经纪业务月报",
  "subtitle": "内部报告 · 谨慎传阅",
  "meta": {"作者": "数据团队", "日期": "2026-06-30", "部门": "经纪业务部"},
  "sections": [
    {"heading": "业务概览",
     "paragraphs": ["本月...", "整体..."],
     "bullets": ["新增客户 1200 户", "佣金环比 +8%"]},
    {"heading": "分营业部明细",
     "table": {"columns": ["营业部", "新增客户", "佣金(万元)"],
                "rows": [["深圳分公司", 320, 45.2], ["北京分公司", 280, 39.1]]}},
    {"heading": "月度趋势",
     "chart": {"type": "bar", "title": "近6月新增客户",
                "labels": ["1月","2月","3月","4月","5月","6月"],
                "series": [{"name": "新增客户", "data": [800, 900, 850, 1000, 1100, 1200]}]}}
  ]
}

chart.type: bar | line | pie（pie 只取第一个 series）
"""
import argparse
import json
import os
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from docx import Document
    from docx.shared import Pt, Inches, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
except ImportError:
    sys.exit("[report-builder] 缺少 python-docx，请先安装：python -m pip install python-docx")


def _load_spec(path):
    with open(path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    if not isinstance(spec, dict):
        sys.exit("[report-builder] spec 必须是 JSON 对象")
    return spec


def _new_document(template):
    if template:
        if not os.path.exists(template):
            sys.exit("[report-builder] 模板不存在：%s" % template)
        return Document(template)
    # 无模板：新建并设置基础页眉页脚（简易公司模板）
    doc = Document()
    section = doc.sections[0]
    header = section.header.paragraphs[0]
    header.text = "内部报告 · 谨慎传阅"
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    for run in header.runs:
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    return doc


def _add_title(doc, spec):
    title = spec.get("title") or "报告"
    h = doc.add_heading(title, level=0)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle = spec.get("subtitle")
    if subtitle:
        p = doc.add_paragraph(subtitle)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in p.runs:
            run.font.size = Pt(11)
            run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    meta = spec.get("meta")
    if isinstance(meta, dict) and meta:
        line = "    ".join("%s：%s" % (k, v) for k, v in meta.items())
        p = doc.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in p.runs:
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
    doc.add_paragraph()


def _add_table(doc, table):
    columns = table.get("columns") or []
    rows = table.get("rows") or []
    if not columns:
        return
    t = doc.add_table(rows=1, cols=len(columns))
    t.style = "Light Grid Accent 1"
    for i, col in enumerate(columns):
        cell = t.rows[0].cells[i]
        cell.text = str(col)
        for p in cell.paragraphs:
            for run in p.runs:
                run.font.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i in range(len(columns)):
            cells[i].text = "" if i >= len(row) else str(row[i])
    doc.add_paragraph()


def _render_chart(chart, out_png):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return None, "matplotlib 未安装，已跳过图表"

    # 中文字体，避免图表中文乱码
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "SimSun", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    ctype = (chart.get("type") or "bar").lower()
    labels = chart.get("labels") or []
    series = chart.get("series") or []
    if not series:
        return None, "图表缺少 series，已跳过"

    fig, ax = plt.subplots(figsize=(6.2, 3.4), dpi=150)
    try:
        if ctype == "pie":
            data = series[0].get("data") or []
            ax.pie(data, labels=labels or None, autopct="%1.1f%%", startangle=90)
            ax.axis("equal")
        elif ctype == "line":
            x = range(len(labels)) if labels else None
            for s in series:
                ax.plot(labels or list(range(len(s.get("data") or []))),
                        s.get("data") or [], marker="o", label=s.get("name", ""))
            if any(s.get("name") for s in series):
                ax.legend()
            ax.grid(True, alpha=0.3)
        else:  # bar
            import numpy as np
            n = len(series)
            idx = np.arange(len(labels)) if labels else np.arange(len(series[0].get("data") or []))
            width = 0.8 / max(n, 1)
            for k, s in enumerate(series):
                ax.bar(idx + k * width, s.get("data") or [], width, label=s.get("name", ""))
            ax.set_xticks(idx + width * (n - 1) / 2)
            ax.set_xticklabels(labels)
            if any(s.get("name") for s in series):
                ax.legend()
            ax.grid(True, axis="y", alpha=0.3)
        if chart.get("title"):
            ax.set_title(chart["title"])
        fig.tight_layout()
        fig.savefig(out_png, bbox_inches="tight")
        return out_png, None
    finally:
        plt.close(fig)


def _add_section(doc, section, tmpdir, idx):
    heading = section.get("heading")
    if heading:
        doc.add_heading(heading, level=1)
    for para in section.get("paragraphs") or []:
        doc.add_paragraph(str(para))
    for bullet in section.get("bullets") or []:
        doc.add_paragraph(str(bullet), style="List Bullet")
    if isinstance(section.get("table"), dict):
        _add_table(doc, section["table"])
    if isinstance(section.get("chart"), dict):
        out_png = os.path.join(tmpdir, "chart_%d.png" % idx)
        path, warn = _render_chart(section["chart"], out_png)
        if path:
            doc.add_picture(path, width=Inches(6.0))
            last = doc.paragraphs[-1]
            last.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif warn:
            print("[report-builder] 第 %d 节：%s" % (idx + 1, warn), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(prog="build_report")
    ap.add_argument("spec")
    ap.add_argument("output")
    ap.add_argument("--template", default="")
    args = ap.parse_args()

    spec = _load_spec(args.spec)
    doc = _new_document(args.template.strip() or None)
    _add_title(doc, spec)

    sections = spec.get("sections") or []
    with tempfile.TemporaryDirectory() as tmpdir:
        for i, section in enumerate(sections):
            if isinstance(section, dict):
                _add_section(doc, section, tmpdir, i)
        doc.save(args.output)

    print("[report-builder] 已生成：%s（%d 节）" % (args.output, len(sections)))


if __name__ == "__main__":
    main()
