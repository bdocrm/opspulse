"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatChartNumber } from "@/components/charts/chart-formatters";

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"];

interface LeaderboardChartProps {
  data: {
    name: string;
    displayName?: string;
    value: number;
    goal?: number | null;
    actual?: number;
    achievement?: number | null;
    rank?: number;
    status?: string;
    recommendation?: string;
  }[];
}

function ExecutiveTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="min-w-[220px] rounded-md border bg-card p-3 text-xs shadow-sm">
      <p className="mb-2 font-semibold text-foreground">{row.name}</p>
      <div className="space-y-1 text-muted-foreground">
        <p>Name: <span className="font-medium text-foreground">{row.name}</span></p>
        <p>Goal: <span className="font-medium text-foreground">{row.goal == null ? "N/A" : formatChartNumber(row.goal)}</span></p>
        <p>Actual: <span className="font-medium text-foreground">{formatChartNumber(row.actual ?? row.value)}</span></p>
        <p>Achievement %: <span className="font-medium text-foreground">{row.achievement == null ? "N/A" : `${Number(row.achievement).toFixed(1)}%`}</span></p>
        <p>Rank: <span className="font-medium text-foreground">{row.rank ?? "N/A"}</span></p>
        <p>Status: <span className="font-medium text-foreground">{row.status ?? "N/A"}</span></p>
        <p>Recommendation: <span className="font-medium text-foreground">{row.recommendation ?? "Review agent activity."}</span></p>
      </div>
    </div>
  );
}

export function LeaderboardChart({ data }: LeaderboardChartProps) {
  const reducedMotion = useReducedMotion();
  const chartData = [...data]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((entry, index) => ({
      ...entry,
      rank: entry.rank ?? index + 1,
      displayName: entry.displayName ?? `#${entry.rank ?? index + 1} ${entry.name}`,
    }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 10, right: 10, left: 24, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="displayName" className="text-xs" tick={{ fontSize: 11 }} width={120} />
        <Tooltip content={<ExecutiveTooltip />} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={!reducedMotion} animationDuration={600} animationEasing="ease-out">
          {chartData.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
