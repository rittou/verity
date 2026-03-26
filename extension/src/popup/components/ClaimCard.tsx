import { useState } from "react";
import type { Claim } from "../../lib/types";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  ChevronDown,
} from "lucide-react";

interface Props {
  claim: Claim;
}

const statusConfig = {
  verified: {
    icon: CheckCircle,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    label: "Verified",
  },
  disputed: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-400/10",
    label: "Disputed",
  },
  misleading: {
    icon: AlertCircle,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    label: "Misleading",
  },
  unverified: {
    icon: HelpCircle,
    color: "text-zinc-400",
    bg: "bg-zinc-400/10",
    label: "Unverified",
  },
  pending: {
    icon: HelpCircle,
    color: "text-zinc-600",
    bg: "bg-zinc-600/10",
    label: "Pending",
  },
};

export function ClaimCard({ claim }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[claim.status];
  const Icon = config.icon;

  return (
    <div
      className="px-4 py-3 cursor-pointer hover:bg-zinc-800/20 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2.5">
        <div className={`p-1 rounded-md mt-0.5 ${config.bg}`}>
          <Icon className={`w-3 h-3 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] leading-relaxed text-zinc-300">
            {claim.text}
          </p>
          <div className="flex items-center gap-2.5 mt-1.5">
            <span className={`text-[10px] font-semibold ${config.color}`}>
              {config.label}
            </span>
            <span className="text-[10px] text-zinc-600">
              {claim.confidence}% confidence
            </span>
            {claim.rationale && (
              <ChevronDown
                className={`w-3 h-3 text-zinc-600 ml-auto transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            )}
          </div>
        </div>
      </div>

      {expanded && claim.rationale && (
        <div className="mt-2.5 ml-[30px] pl-3 border-l-2 border-zinc-800">
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            {claim.rationale}
          </p>
          {claim.fallacies && (
            <p className="text-[10px] text-amber-400/80 mt-1.5">
              Fallacies: {claim.fallacies}
            </p>
          )}
          {claim.existingDebunk && (
            <a
              href={claim.existingDebunk.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-2.5 h-2.5" />
              Source: {claim.existingDebunk.publisher}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
