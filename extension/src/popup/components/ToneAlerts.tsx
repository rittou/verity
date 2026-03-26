import type { ToneAlert } from "../../lib/types";
import { AlertTriangle, Heart, Target } from "lucide-react";

interface Props {
  alerts: ToneAlert[];
}

const typeConfig = {
  emotional: {
    icon: Heart,
    label: "Emotional Manipulation",
    color: "text-pink-400",
    bg: "bg-pink-400/10",
  },
  bias: {
    icon: Target,
    label: "Bias Detected",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  manipulation: {
    icon: AlertTriangle,
    label: "Manipulative Language",
    color: "text-red-400",
    bg: "bg-red-400/10",
  },
};

const severityStyles = {
  low: "bg-zinc-800 text-zinc-400",
  medium: "bg-amber-900/40 text-amber-300",
  high: "bg-red-900/40 text-red-300",
};

export function ToneAlerts({ alerts }: Props) {
  return (
    <div className="border-b border-zinc-800/60">
      <div className="px-4 py-2 bg-zinc-800/30">
        <p className="text-[9px] uppercase tracking-[0.15em] text-zinc-500 font-bold">
          Tone Alerts
        </p>
      </div>
      <div className="divide-y divide-zinc-800/40">
        {alerts.map((alert, i) => {
          const config = typeConfig[alert.type];
          const Icon = config.icon;
          return (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`p-1 rounded-md ${config.bg}`}>
                  <Icon className={`w-3 h-3 ${config.color}`} />
                </div>
                <span
                  className={`text-[10px] font-semibold ${config.color}`}
                >
                  {config.label}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${severityStyles[alert.severity]}`}
                >
                  {alert.severity}
                </span>
              </div>
              <p className="text-[12px] text-zinc-400 leading-relaxed ml-[30px]">
                {alert.description}
              </p>
              {alert.excerpt && (
                <p className="text-[11px] text-zinc-600 italic mt-1 ml-[30px]">
                  &ldquo;{alert.excerpt}&rdquo;
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
