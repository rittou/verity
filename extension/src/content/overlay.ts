import type { AnalysisResult } from "../lib/types";

const OVERLAY_ID = "verity-overlay-root";

function getGradeColor(grade: string): string {
  const colors: Record<string, string> = {
    A: "#22c55e",
    B: "#84cc16",
    C: "#eab308",
    D: "#f97316",
    F: "#ef4444",
  };
  return colors[grade] || "#71717a";
}

export function showOverlay(result: AnalysisResult) {
  removeOverlay();

  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  host.style.cssText =
    "all:initial; position:fixed; top:16px; right:16px; z-index:2147483647; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

  const shadow = host.attachShadow({ mode: "closed" });
  const color = getGradeColor(result.grade);
  const claimSummary = [
    result.claims.filter((c) => c.status === "verified").length,
    result.claims.filter((c) => c.status === "disputed").length,
    result.claims.filter((c) => c.status === "misleading").length,
  ];

  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      .badge{
        background:#18181b;border:1px solid ${color}33;border-radius:14px;
        padding:14px 18px;color:#fafafa;font-size:13px;line-height:1.5;
        box-shadow:0 8px 32px rgba(0,0,0,.5);max-width:300px;
        cursor:default;transition:all .2s ease;opacity:.96;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      }
      .badge:hover{opacity:1;box-shadow:0 12px 40px rgba(0,0,0,.6)}
      .hdr{display:flex;align-items:center;gap:10px;margin-bottom:8px}
      .score{font-size:28px;font-weight:800;color:${color};line-height:1}
      .grade{
        display:inline-flex;align-items:center;justify-content:center;
        width:26px;height:26px;border-radius:7px;font-weight:800;font-size:12px;
        background:${color}1a;color:${color};
      }
      .lbl{font-size:10px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.6px}
      .summary{font-size:12px;color:#d4d4d8;margin-top:2px;line-height:1.5}
      .stats{display:flex;gap:10px;margin-top:8px;font-size:11px}
      .stat{color:#a1a1aa}
      .stat b{font-weight:600}
      .stat.ok b{color:#22c55e}
      .stat.bad b{color:#ef4444}
      .stat.warn b{color:#eab308}
      .close{
        position:absolute;top:10px;right:12px;background:none;border:none;
        color:#52525b;cursor:pointer;font-size:16px;line-height:1;padding:2px;
      }
      .close:hover{color:#fafafa}
    </style>
    <div class="badge" style="position:relative">
      <button class="close" id="close-btn">\u2715</button>
      <div class="hdr">
        <span class="score">${result.trustScore}</span>
        <span class="grade">${result.grade}</span>
        <span class="lbl">Trust Score</span>
      </div>
      <div class="summary">${result.summary.slice(0, 140)}${result.summary.length > 140 ? "\u2026" : ""}</div>
      <div class="stats">
        <span class="stat ok"><b>${claimSummary[0]}</b> verified</span>
        <span class="stat bad"><b>${claimSummary[1]}</b> disputed</span>
        <span class="stat warn"><b>${claimSummary[2]}</b> misleading</span>
      </div>
    </div>
  `;

  shadow.getElementById("close-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    removeOverlay();
  });

  document.body.appendChild(host);
}

export function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}
