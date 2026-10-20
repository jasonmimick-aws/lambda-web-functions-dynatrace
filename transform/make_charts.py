"""Generate cohesive, dashboard-styled figures for the one-pager from measured POC data."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np
import os

OUT = os.path.join(os.path.dirname(__file__), "one-pager-assets")
os.makedirs(OUT, exist_ok=True)

# ---- Design system ----
BG, PANEL, GRID = "#0d1117", "#0d1117", "#232c3b"
TXT, MUTE = "#e6edf3", "#8b98ad"
FARGATE, WEBFN = "#ff9d2e", "#a371f7"
GREEN, RED = "#6fd38a", "#ff7b7b"
plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": PANEL, "savefig.facecolor": BG,
    "font.family": "sans-serif", "font.sans-serif": ["Helvetica Neue", "Arial", "DejaVu Sans"],
    "text.color": TXT, "axes.labelcolor": MUTE,
    "xtick.color": MUTE, "ytick.color": MUTE, "font.size": 11,
})

def style(ax, yaxis=True):
    for s in ax.spines.values():
        s.set_visible(False)
    ax.grid(axis="y" if yaxis else "x", color=GRID, linewidth=1, alpha=0.9, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)

def legend_dots(ax, items, anchor=(0.0, 0.99)):
    handles = [Line2D([0], [0], marker="o", linestyle="", markersize=9,
                      markerfacecolor=c, markeredgecolor="none", label=l) for l, c in items]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=anchor, frameon=False,
              labelcolor=TXT, handletextpad=0.3, fontsize=10, borderaxespad=0.0)

def heading(fig, title, subtitle):
    fig.text(0.015, 0.95, title, fontsize=15, fontweight="bold", color=TXT, va="top")
    fig.text(0.015, 0.88, subtitle, fontsize=10, color=MUTE, va="top")

# =========================================================================
# Figure 1 - latency distribution (I/O endpoint)
# =========================================================================
labels = ["p50", "p99", "p99.9", "max"]
fargate = [37.2, 57.4, 96.6, 104.6]
webfn   = [37.2, 57.4, 162.5, 290.2]
x = np.arange(len(labels)); w = 0.34
fig, ax = plt.subplots(figsize=(8.4, 4.8)); fig.subplots_adjust(top=0.76, bottom=0.12, left=0.1, right=0.97)
style(ax)
ax.axvspan(1.5, 3.6, color=RED, alpha=0.06, zorder=0)
ax.bar(x - w/2, fargate, w, color=FARGATE, zorder=3)
ax.bar(x + w/2, webfn, w, color=WEBFN, zorder=3)
for xi, v in zip(x - w/2, fargate): ax.text(xi, v + 6, f"{v:.0f}", ha="center", color=FARGATE, fontsize=10, fontweight="bold")
for xi, v in zip(x + w/2, webfn):   ax.text(xi, v + 6, f"{v:.0f}", ha="center", color=WEBFN, fontsize=10, fontweight="bold")
ax.set_xticks(x); ax.set_xticklabels(labels, color=TXT, fontsize=12)
ax.set_xlim(-0.6, 3.6); ax.set_ylim(0, 325); ax.set_ylabel("response time (ms)")
ax.text(0.5, 130, "equivalent\nthrough p99", color=GREEN, fontsize=10, ha="center", va="bottom", fontweight="bold")
ax.text(2.5, 245, "cold-start tail", color=RED, fontsize=10.5, ha="center", va="bottom", fontweight="bold")
legend_dots(ax, [("Fargate", FARGATE), ("Web Functions", WEBFN)])
heading(fig, "Response time by percentile",
        "I/O endpoint, steady load   ·   same code on Fargate and Lambda Web Functions")
fig.text(0.015, 0.01, "Source: measured POC, us-east-1 · OpenTelemetry to Dynatrace", color=MUTE, fontsize=8)
fig.savefig(os.path.join(OUT, "fig1-latency-tail.png"), dpi=160); plt.close(fig)

# =========================================================================
# Figure 2 - CPU-bound (throughput + p99)
# =========================================================================
conc = ["10", "50"]
f_rps, w_rps = [38.7, 38.8], [48.2, 69.0]
f_p99, w_p99 = [440, 6498], [324, 1133]
x = np.arange(len(conc)); w = 0.32
fig, (axl, axr) = plt.subplots(1, 2, figsize=(11, 5.0))
fig.subplots_adjust(top=0.70, bottom=0.14, left=0.08, right=0.97, wspace=0.28)
for ax in (axl, axr):
    style(ax); ax.set_xticks(x); ax.set_xticklabels(conc, color=TXT, fontsize=12)
    ax.set_xlabel("concurrent clients"); ax.set_xlim(-0.65, 1.65)

axl.bar(x - w/2, f_rps, w, color=FARGATE, zorder=3)
axl.bar(x + w/2, w_rps, w, color=WEBFN, zorder=3)
axl.set_ylim(0, 82); axl.set_ylabel("requests / sec")
for xi, v in zip(x - w/2, f_rps): axl.text(xi, v + 1.5, f"{v:.0f}", ha="center", color=FARGATE, fontweight="bold", fontsize=10)
for xi, v in zip(x + w/2, w_rps): axl.text(xi, v + 1.5, f"{v:.0f}", ha="center", color=WEBFN, fontweight="bold", fontsize=10)
axl.set_title("Throughput", color=TXT, fontsize=12, fontweight="bold", loc="left", pad=8)
legend_dots(axl, [("Fargate", FARGATE), ("Web Functions", WEBFN)], anchor=(0.0, 0.985))

axr.set_yscale("log")
axr.bar(x - w/2, f_p99, w, color=FARGATE, zorder=3)
axr.bar(x + w/2, w_p99, w, color=WEBFN, zorder=3)
axr.set_ylim(200, 12000); axr.set_ylabel("p99 latency (ms, log)")
for xi, v in zip(x - w/2, f_p99): axr.text(xi, v * 1.09, f"{v:,}", ha="center", color=FARGATE, fontweight="bold", fontsize=10)
for xi, v in zip(x + w/2, w_p99): axr.text(xi, v * 1.09, f"{v:,}", ha="center", color=WEBFN, fontweight="bold", fontsize=10)
axr.set_title("p99 latency", color=TXT, fontsize=12, fontweight="bold", loc="left", pad=8)

heading(fig, "CPU-bound: the gap is capacity, not efficiency",
        "Fargate fixed at ~1 vCPU while Web Functions scaled freely; active-CPU billing saves nothing when the CPU is never idle")
fig.savefig(os.path.join(OUT, "fig2-cpu-saturation.png"), dpi=160); plt.close(fig)

# =========================================================================
# Figure 3 - steady throughput (horizontal)
# =========================================================================
fig, ax = plt.subplots(figsize=(8.4, 3.2))
fig.subplots_adjust(top=0.70, bottom=0.18, left=0.26, right=0.95)
style(ax, yaxis=False)
plats, vals, cols = ["Web Functions", "Fargate"], [398, 320], [WEBFN, FARGATE]
y = np.arange(len(plats))
ax.barh(y, vals, height=0.5, color=cols, zorder=3)
for yi, v, c in zip(y, vals, cols):
    ax.text(v + 6, yi, f"{v} req/s", va="center", color=c, fontweight="bold", fontsize=11)
ax.set_yticks(y); ax.set_yticklabels(plats, color=TXT, fontsize=12)
ax.set_xlim(0, 460); ax.set_ylim(-0.6, 1.6); ax.set_xlabel("requests / sec")
heading(fig, "Throughput at steady load",
        "equal request mix   ·   Fargate sized to 2x0.5 vCPU, Web Functions unsized")
fig.text(0.015, 0.02, "Source: measured POC, us-east-1", color=MUTE, fontsize=8)
fig.savefig(os.path.join(OUT, "fig3-throughput.png"), dpi=160); plt.close(fig)

print("charts written:")
for f in sorted(os.listdir(OUT)):
    if f.endswith(".png"): print(" -", f)
