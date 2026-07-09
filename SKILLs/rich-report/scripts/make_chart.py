from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt
import pandas as pd

# 内置 embed Python 的 ._pth 会接管 sys.path 且忽略 PYTHONPATH，
# 脚本目录不会自动加入，需显式插入才能 import 同目录的 report_style。
import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parent))
from report_style import apply_report_axis_style, configure_matplotlib, save_report_figure


CHART_TYPES = ("line", "bar", "hbar", "stacked-bar", "area", "scatter")


def read_table(path: Path, sheet: str | None) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(path)
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path, sheet_name=sheet or 0)
    if suffix in {".csv", ".txt"}:
        return pd.read_csv(path, encoding="utf-8-sig")
    raise ValueError(f"Unsupported input file type: {suffix}")


def require_columns(df: pd.DataFrame, columns: Iterable[str]) -> None:
    missing = [column for column in columns if column not in df.columns]
    if missing:
        raise ValueError(f"Missing columns: {', '.join(missing)}")


def coerce_numeric(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    output = df.copy()
    for column in columns:
        output[column] = pd.to_numeric(output[column], errors="coerce")
    return output


def build_chart(args: argparse.Namespace) -> Path:
    configure_matplotlib()
    input_path = Path(args.input)
    output_path = Path(args.output)
    df = read_table(input_path, args.sheet)

    require_columns(df, [args.x, *args.y])
    df = df.dropna(subset=[args.x])
    df = coerce_numeric(df, args.y)

    fig, ax = plt.subplots(figsize=parse_figsize(args.figsize))

    if args.chart_type == "line":
        df.plot(x=args.x, y=args.y, ax=ax, marker="o", linewidth=2)
    elif args.chart_type == "bar":
        df.plot(x=args.x, y=args.y, ax=ax, kind="bar", width=0.72)
    elif args.chart_type == "hbar":
        df.plot(x=args.x, y=args.y, ax=ax, kind="barh", width=0.72)
    elif args.chart_type == "stacked-bar":
        df.plot(x=args.x, y=args.y, ax=ax, kind="bar", stacked=True, width=0.72)
    elif args.chart_type == "area":
        df.set_index(args.x)[args.y].plot.area(ax=ax, alpha=0.82, linewidth=1.2)
    elif args.chart_type == "scatter":
        for y_col in args.y:
            ax.scatter(df[args.x], df[y_col], label=y_col, s=42, alpha=0.82)
    else:
        raise ValueError(f"Unsupported chart type: {args.chart_type}")

    ax.set_title(args.title)
    apply_report_axis_style(ax, xlabel=args.xlabel or args.x, ylabel=args.ylabel or "")

    if args.chart_type in {"bar", "stacked-bar"} and len(df) > 8:
        ax.tick_params(axis="x", labelrotation=35)
    if args.chart_type != "scatter" and len(args.y) == 1:
        legend = ax.get_legend()
        if legend:
            legend.remove()
    elif len(args.y) > 1:
        ax.legend(loc="best")

    return save_report_figure(fig, output_path, source=args.source)


def parse_figsize(value: str) -> tuple[float, float]:
    try:
        width, height = value.lower().split("x", 1)
        return float(width), float(height)
    except Exception as exc:
        raise argparse.ArgumentTypeError("figsize must look like 8x4.8") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a research-report-style matplotlib chart.")
    parser.add_argument("--input", required=True, help="CSV, TXT, XLS, or XLSX file.")
    parser.add_argument("--output", required=True, help="Output PNG path.")
    parser.add_argument("--chart-type", required=True, choices=CHART_TYPES)
    parser.add_argument("--x", required=True, help="Column for x axis or categories.")
    parser.add_argument("--y", nargs="+", required=True, help="One or more numeric columns.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--source", default="")
    parser.add_argument("--sheet", default=None, help="Excel sheet name.")
    parser.add_argument("--xlabel", default="")
    parser.add_argument("--ylabel", default="")
    parser.add_argument("--figsize", default="8x4.8")
    return parser.parse_args()


if __name__ == "__main__":
    chart_path = build_chart(parse_args())
    print(chart_path)
