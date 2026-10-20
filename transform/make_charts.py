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

# =========================================================================
# Figure 4 - direct cost vs utilization (break-even)
# =========================================================================
U = np.linspace(0, 100, 101)
F = 60.0              # Fargate: flat monthly baseline (2x0.5 vCPU + ALB), illustrative
SLOPE = 0.70          # Web Functions: cost tracks active-CPU utilization
web = SLOPE * U
be = F / SLOPE        # break-even utilization
fig, ax = plt.subplots(figsize=(8.6, 4.8)); fig.subplots_adjust(top=0.74, bottom=0.14, left=0.1, right=0.96)
style(ax)
ax.axvspan(0, be, color=WEBFN, alpha=0.07, zorder=0)
ax.axvspan(be, 100, color=FARGATE, alpha=0.07, zorder=0)
ax.axvspan(5, 30, color=GREEN, alpha=0.12, zorder=0)
ax.plot(U, [F]*len(U), color=FARGATE, lw=3, zorder=3)
ax.plot(U, web, color=WEBFN, lw=3, zorder=3)
ax.axvline(be, color=MUTE, ls="--", lw=1.2, zorder=2)
ax.text(be, 77, f"break-even ~{be:.0f}%", color=TXT, fontsize=9.5, ha="center", fontweight="bold")
ax.text(52, 63, "Fargate (flat)", color=FARGATE, fontsize=10.5, fontweight="bold")
ax.text(60, 50, "Web Functions (active-CPU)", color=WEBFN, fontsize=10.5, fontweight="bold", va="center")
ax.text(17.5, 6, "typical web / API / GenAI\n5-30% utilization", color=GREEN, fontsize=9.5, ha="center", fontweight="bold")
ax.text(42, 70, "Web Functions cheaper", color=WEBFN, fontsize=10, ha="center")
ax.text(93, 30, "Fargate\ncheaper", color=FARGATE, fontsize=10, ha="center")
ax.set_xlim(0, 100); ax.set_ylim(0, 85)
ax.set_xlabel("sustained CPU utilization (%)"); ax.set_ylabel("relative monthly cost (USD)")
heading(fig, "Direct cost vs utilization",
        "Fargate is flat regardless of traffic; Web Functions tracks active CPU. Illustrative - validate on the AWS Pricing Calculator.")
fig.savefig(os.path.join(OUT, "fig4-cost-utilization.png"), dpi=160); plt.close(fig)

# =========================================================================
# Figure 5 - monthly cost by workload shape
# =========================================================================
labels = ["Steady 24/7\nCPU batch", "Business-hours\nI/O API", "Bursty GenAI\nendpoint"]
far = [60, 60, 60]; web = [70, 15, 8]
x = np.arange(len(labels)); w = 0.34
fig, ax = plt.subplots(figsize=(8.6, 4.8)); fig.subplots_adjust(top=0.74, bottom=0.14, left=0.1, right=0.96)
style(ax)
ax.bar(x - w/2, far, w, color=FARGATE, zorder=3)
ax.bar(x + w/2, web, w, color=WEBFN, zorder=3)
for xi, v in zip(x - w/2, far): ax.text(xi, v + 1.5, f"${v}", ha="center", color=FARGATE, fontweight="bold", fontsize=10)
for xi, v in zip(x + w/2, web): ax.text(xi, v + 1.5, f"${v}", ha="center", color=WEBFN, fontweight="bold", fontsize=10)
ax.set_xticks(x); ax.set_xticklabels(labels, color=TXT, fontsize=11)
ax.set_ylim(0, 82); ax.set_ylabel("relative monthly cost (USD)")
legend_dots(ax, [("Fargate", FARGATE), ("Web Functions", WEBFN)], anchor=(0.0, 0.99))
heading(fig, "Monthly cost by workload shape",
        "Steady CPU favors provisioned; the common bursty / I/O / GenAI cases are several times cheaper. Illustrative.")
fig.savefig(os.path.join(OUT, "fig5-cost-scenarios.png"), dpi=160); plt.close(fig)

# =========================================================================
# Figure 6 - operational surface (maintenance / TCO)
# =========================================================================
fig, ax = plt.subplots(figsize=(8.6, 3.2)); fig.subplots_adjust(top=0.70, bottom=0.14, left=0.26, right=0.95)
style(ax, yaxis=False)
plats = ["Web Functions", "Fargate"]; comps = [1, 7]; cols = [WEBFN, FARGATE]
y = np.arange(len(plats))
ax.barh(y, comps, height=0.5, color=cols, zorder=3)
ax.text(1 + 0.1, 0, "1  (one deploy command)", va="center", color=WEBFN, fontweight="bold", fontsize=11)
ax.text(7 + 0.1, 1, "7  (image, ECR, cluster, ALB+TG, autoscaling, task defs, patching)", va="center", color=FARGATE, fontweight="bold", fontsize=10)
ax.set_yticks(y); ax.set_yticklabels(plats, color=TXT, fontsize=12)
ax.set_xlim(0, 11); ax.set_ylim(-0.6, 1.6); ax.set_xlabel("components to own and maintain")
heading(fig, "Operational surface (what you maintain)",
        "The indirect cost that dominates TCO at fleet scale.")
fig.savefig(os.path.join(OUT, "fig6-ops-surface.png"), dpi=160); plt.close(fig)

print("charts written:")
for f in sorted(os.listdir(OUT)):
    if f.endswith(".png"): print(" -", f)
