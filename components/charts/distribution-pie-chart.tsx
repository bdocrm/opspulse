"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = ["#6366f1", "#22c55e", "#eab308", "#ef4444", "#3b82f6", "#f97316"];

interface DistributionPieChartProps {
  data: {
    name: string;
    value: number;
    goal?: number | null;
    actual?: number;
    achievement?: number | null;
    contribution?: number | null;
    rank?: number;
    status?: string;
    recommendation?: string;
  }[];
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function ExecutiveTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="min-w-[220px] rounded-md border bg-card p-3 text-xs shadow-sm">
      <p className="mb-2 font-semibold text-foreground">{row.name}</p>
      <div className="space-y-1 text-muted-foreground">
        <p>Name: <span className="font-medium text-foreground">{row.name}</span></p>
        <p>Goal: <span className="font-medium text-foreground">{row.goal == null ? "N/A" : formatNumber(row.goal)}</span></p>
        <p>Actual: <span className="font-medium text-foreground">{formatNumber(row.actual ?? row.value)}</span></p>
        <p>Achievement %: <span className="font-medium text-foreground">{row.achievement == null ? "N/A" : `${Number(row.achievement).toFixed(1)}%`}</span></p>
        <p>Rank: <span className="font-medium text-foreground">{row.rank ?? "N/A"}</span></p>
        <p>Status: <span className="font-medium text-foreground">{row.status ?? "N/A"}</span></p>
        <p>Recommendation: <span className="font-medium text-foreground">{row.recommendation ?? "Review contribution share."}</span></p>
      </div>
    </div>
  );
}

export function DistributionPieChart({ data }: DistributionPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={3}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
        >
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<ExecutiveTooltip />} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
