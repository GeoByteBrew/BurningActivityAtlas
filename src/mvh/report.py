"""Small helpers for Markdown reports."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _fmt(v) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "–"
    if isinstance(v, (bool, np.bool_)):
        return "yes" if v else "no"
    if isinstance(v, (int, np.integer)):
        return f"{int(v):,}".replace(",", " ")
    if isinstance(v, (float, np.floating)):
        a = abs(v)
        if a >= 1000:
            return f"{v:,.0f}".replace(",", " ")
        if a >= 10:
            return f"{v:.1f}"
        return f"{v:.3g}" if a < 0.01 else f"{v:.2f}"
    return str(v)


def md_table(df: pd.DataFrame) -> str:
    cols = [str(c) for c in df.columns]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    plain = {i for i, c in enumerate(cols) if c in ("year", "month")}  # no thousands separator
    for row in df.itertuples(index=False):
        lines.append("| " + " | ".join(str(int(v)) if i in plain and pd.notna(v) else _fmt(v)
                                       for i, v in enumerate(row)) + " |")
    return "\n".join(lines)
