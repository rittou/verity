import { useState, useEffect, useRef } from "react";
import {
  Shield,
  Search,
  Brain,
  FileCheck,
  Check,
  type LucideIcon,
} from "lucide-react";

interface Step {
  icon: LucideIcon;
  label: string;
  detail: string;
  duration: number;
}

const steps: Step[] = [
  {
    icon: FileCheck,
    label: "Extracting claims",
    detail: "Identifying verifiable statements",
    duration: 3000,
  },
  {
    icon: Search,
    label: "Searching the web",
    detail: "Grounding claims against live sources",
    duration: 4000,
  },
  {
    icon: Brain,
    label: "AI reasoning",
    detail: "Chain-of-thought fallacy detection",
    duration: 6000,
  },
  {
    icon: Shield,
    label: "Building report",
    detail: "Scoring credibility & tone",
    duration: 2000,
  },
];

const TOTAL_ESTIMATED = steps.reduce((s, step) => s + step.duration, 0);
const BASE_MAX_VISIBLE_PROGRESS = 97;
const MAX_PROGRESS_OVER_TIME = 99;

interface AnalysisProgressProps {
  startedAt?: number;
}

export function AnalysisProgress({ startedAt }: AnalysisProgressProps) {
  const startTime = useRef(startedAt || Date.now());
  const initialElapsed = useRef(Date.now() - startTime.current);

  const computeInitialStep = () => {
    const ms = initialElapsed.current;
    let cumulative = 0;
    for (let i = 0; i < steps.length; i++) {
      cumulative += steps[i].duration;
      if (ms < cumulative) return i;
    }
    return steps.length - 1;
  };

  const [currentStep, setCurrentStep] = useState(computeInitialStep);
  const [stepProgress, setStepProgress] = useState(0);
  const [elapsed, setElapsed] = useState(
    Math.floor(initialElapsed.current / 1000),
  );

  useEffect(() => {
    const ms = initialElapsed.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cumulative = 0;
    for (let i = 1; i < steps.length; i++) {
      cumulative += steps[i - 1].duration;
      const remaining = cumulative - ms;
      if (remaining > 0) {
        const step = i;
        timers.push(setTimeout(() => setCurrentStep(step), remaining));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const ms = initialElapsed.current;
    let cumulativeBefore = 0;
    for (let i = 0; i < currentStep; i++) cumulativeBefore += steps[i].duration;
    const elapsedInStep = Math.max(0, ms - cumulativeBefore);
    const dur = steps[currentStep].duration;
    const startPct = Math.min(100, (elapsedInStep / dur) * 100);

    setStepProgress(startPct);
    const interval = 50;
    const increment = (100 / dur) * interval;
    const id = setInterval(() => {
      setStepProgress((p) => Math.min(100, p + increment));
    }, interval);
    return () => clearInterval(id);
  }, [currentStep]);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const overtimeSeconds = Math.max(
    0,
    elapsed - Math.round(TOTAL_ESTIMATED / 1000),
  );
  const dynamicMaxProgress = Math.min(
    MAX_PROGRESS_OVER_TIME,
    BASE_MAX_VISIBLE_PROGRESS + Math.floor(overtimeSeconds / 5),
  );

  const overallProgress = Math.min(
    dynamicMaxProgress,
    ((currentStep / steps.length) * 100 +
      (stepProgress / steps.length)) |
      0,
  );

  const takingLongerThanExpected = elapsed > Math.round(TOTAL_ESTIMATED / 1000);

  return (
    <div className="flex-1 flex flex-col items-center gap-6 py-5">
      {/* Spinner + score circle */}
      <div className="relative w-[72px] h-[72px]">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
          <circle
            cx="36"
            cy="36"
            r="30"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-zinc-800"
          />
          <circle
            cx="36"
            cy="36"
            r="30"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 30}`}
            strokeDashoffset={`${2 * Math.PI * 30 * (1 - overallProgress / 100)}`}
            className="text-emerald-400 transition-all duration-300 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[15px] font-bold text-emerald-400 tabular-nums">
            {overallProgress}%
          </span>
        </div>
      </div>

      {/* Step list */}
      <div className="flex flex-col gap-1 w-full">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          const isPending = i > currentStep;

          return (
            <div
              key={i}
              className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-500 ${
                isActive
                  ? "bg-zinc-800/80"
                  : isDone
                    ? "bg-zinc-800/20"
                    : ""
              }`}
            >
              {/* Icon area */}
              <div
                className={`relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 ${
                  isActive
                    ? "bg-emerald-500/15"
                    : isDone
                      ? "bg-emerald-500/10"
                      : "bg-zinc-800/50"
                }`}
              >
                {isDone ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
                ) : (
                  <Icon
                    className={`w-3.5 h-3.5 transition-colors duration-500 ${
                      isActive
                        ? "text-emerald-400"
                        : "text-zinc-600"
                    }`}
                  />
                )}
                {isActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                )}
              </div>

              {/* Text area */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[12px] font-medium transition-colors duration-500 ${
                      isActive
                        ? "text-zinc-100"
                        : isDone
                          ? "text-zinc-400"
                          : "text-zinc-600"
                    }`}
                  >
                    {step.label}
                  </span>

                  {isDone && (
                    <span className="text-[10px] text-emerald-500/70 font-medium">
                      Done
                    </span>
                  )}
                  {isPending && (
                    <span className="text-[10px] text-zinc-700">
                      Waiting
                    </span>
                  )}
                </div>

                {/* Active step: detail text + progress bar */}
                {isActive && (
                  <div className="mt-1.5 space-y-1.5">
                    <p className="text-[10px] text-zinc-500">
                      {step.detail}
                    </p>
                    <div className="h-[3px] rounded-full bg-zinc-700/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-400/80 transition-all duration-100 ease-linear"
                        style={{ width: `${stepProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 text-[11px] text-zinc-600">
        <span className="tabular-nums">
          {elapsed}s elapsed
        </span>
        <span className="w-px h-3 bg-zinc-800" />
        <span>
          {takingLongerThanExpected
            ? "Still waiting for AI reasoning/report completion"
            : `~${Math.max(0, Math.round((TOTAL_ESTIMATED / 1000) - elapsed))}s remaining`}
        </span>
      </div>
    </div>
  );
}
