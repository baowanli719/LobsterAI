from __future__ import annotations

from pathlib import Path
from typing import Optional, Sequence

import matplotlib as mpl
import matplotlib.pyplot as plt
from cycler import cycler
from matplotlib.font_manager import fontManager


REPORT_FONT = "Microsoft YaHei"

PALETTE = [
    "#1F5C99",
    "#B6423C",
    "#3E7C59",
    "#C9872A",
    "#6B5CA5",
    "#62717B",
]

GRID_COLOR = "#D9DEE7"
TEXT_COLOR = "#1F2933"
MUTED_TEXT_COLOR = "#6B7280"


def find_chinese_font() -> str:
    available = {font.name for font in fontManager.ttflist}
    if REPORT_FONT not in available:
        raise RuntimeError("Microsoft YaHei font is required for rich-report charts.")
    return REPORT_FONT


def configure_matplotlib(font_name: Optional[str] = None) -> str:
    selected_font = font_name or find_chinese_font()
    mpl.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": [selected_font],
            "axes.unicode_minus": False,
            "figure.dpi": 130,
            "savefig.dpi": 300,
            "savefig.facecolor": "white",
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.edgecolor": "#AAB3C2",
            "axes.labelcolor": TEXT_COLOR,
            "axes.titlecolor": TEXT_COLOR,
            "xtick.color": TEXT_COLOR,
            "ytick.color": TEXT_COLOR,
            "text.color": TEXT_COLOR,
            "axes.prop_cycle": cycler(color=PALETTE),
            "axes.grid": True,
            "grid.color": GRID_COLOR,
            "grid.linestyle": "-",
            "grid.linewidth": 0.8,
            "legend.frameon": False,
            "legend.fontsize": 9,
            "axes.titlesize": 14,
            "axes.labelsize": 10,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9,
        }
    )
    return selected_font


def apply_report_axis_style(ax: plt.Axes, xlabel: str = "", ylabel: str = "") -> None:
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.85)
    ax.grid(axis="x", alpha=0.0)


def add_source_note(fig: plt.Figure, source: Optional[str]) -> None:
    if not source:
        return
    note = source if source.startswith("资料来源") else f"资料来源：{source}"
    fig.text(0.01, 0.01, note, ha="left", va="bottom", fontsize=8, color=MUTED_TEXT_COLOR)


def save_report_figure(fig: plt.Figure, output_path: str | Path, source: Optional[str] = None) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    add_source_note(fig, source)
    fig.savefig(path, bbox_inches="tight", pad_inches=0.18)
    plt.close(fig)
    return path


def ensure_non_empty_series(values: Sequence[object], label: str) -> None:
    if not values:
        raise ValueError(f"{label} is empty")
