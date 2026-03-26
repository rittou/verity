import { gradeColor } from "../../lib/utils";

interface Props {
  score: number;
  grade: string;
}

export function TrustBadge({ score, grade }: Props) {
  const color = gradeColor(grade);

  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="text-[28px] font-extrabold tabular-nums" style={{ color }}>
        {score}
      </div>
      <div
        className="text-[10px] font-bold px-2.5 py-0.5 rounded-md tracking-wide"
        style={{ backgroundColor: `${color}1a`, color }}
      >
        {grade}
      </div>
    </div>
  );
}
