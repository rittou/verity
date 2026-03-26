import type { AnalysisResult } from "../../lib/types";
import { TrustBadge } from "./TrustBadge";
import { ClaimCard } from "./ClaimCard";
import { ToneAlerts } from "./ToneAlerts";

interface Props {
  result: AnalysisResult;
}

export function NutritionLabel({ result }: Props) {
  const disputed = result.claims.filter(
    (c) => c.status === "disputed" || c.status === "misleading",
  ).length;
  const verified = result.claims.filter(
    (c) => c.status === "verified",
  ).length;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header — score area, styled like a nutrition facts label */}
      <div className="p-4 border-b-[3px] border-zinc-700">
        <p className="text-[9px] uppercase tracking-[0.15em] text-zinc-500 font-bold mb-2">
          Credibility Report
        </p>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[13px] font-semibold leading-snug text-zinc-200 flex-1">
            {result.title}
          </h2>
          <TrustBadge score={result.trustScore} grade={result.grade} />
        </div>
      </div>

      {/* Quick stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-zinc-800/40 border-b border-zinc-800 text-[11px]">
        <span className="text-zinc-400">
          <b className="text-emerald-400 font-semibold">{verified}</b>{" "}
          verified
        </span>
        <span className="text-zinc-400">
          <b className="text-red-400 font-semibold">{disputed}</b>{" "}
          flagged
        </span>
        <span className="text-zinc-400">
          <b className="text-zinc-300 font-semibold">
            {result.claims.length}
          </b>{" "}
          total
        </span>
        {result.toneAlerts.length > 0 && (
          <span className="text-amber-400 ml-auto font-medium">
            {result.toneAlerts.length} alert
            {result.toneAlerts.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="px-4 py-3 border-b border-zinc-800/60">
        <p className="text-[12px] text-zinc-400 leading-relaxed">
          {result.summary}
        </p>
      </div>

      {/* Claims breakdown */}
      <div className="border-b border-zinc-800/60">
        <div className="px-4 py-2 bg-zinc-800/30">
          <p className="text-[9px] uppercase tracking-[0.15em] text-zinc-500 font-bold">
            Claims Breakdown
          </p>
        </div>
        <div className="divide-y divide-zinc-800/40">
          {result.claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </div>
      </div>

      {/* Tone alerts */}
      {result.toneAlerts.length > 0 && (
        <ToneAlerts alerts={result.toneAlerts} />
      )}

      {/* Footer */}
      <div className="px-4 py-2 bg-zinc-800/20">
        <p className="text-[10px] text-zinc-600 text-center">
          Analyzed {new Date(result.analyzedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
