"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface DailyLineChartProps {
  data: {
    date: string;
    value: number;
    goal?: number | null;
    actual?: number;
    achievement?: number | null;
    rank?: number;
    status?: string;
    recommendation?: string;
  }[];
  color?: string;
  label?: string;
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function ExecutiveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="min-w-[220px] rounded-md border bg-card p-3 text-xs shadow-sm">
      <p className="mb-2 font-semibold text-foreground">{row.date ?? label}</p>
      <div className="space-y-1 text-muted-foreground">
        <p>Name: <span className="font-medium text-foreground">{row.date ?? label}</span></p>
        <p>Goal: <span className="font-medium text-foreground">{row.goal == null ? "N/A" : formatNumber(row.goal)}</span></p>
        <p>Actual: <span className="font-medium text-foreground">{formatNumber(row.actual ?? row.value)}</span></p>
        <p>Achievement %: <span className="font-medium text-foreground">{row.achievement == null ? "N/A" : `${Number(row.achievement).toFixed(1)}%`}</span></p>
        <p>Rank: <span className="font-medium text-foreground">{row.rank ?? "N/A"}</span></p>
        <p>Status: <span className="font-medium text-foreground">{row.status ?? "Information / Trend"}</span></p>
        <p>Recommendation: <span className="font-medium text-foreground">{row.recommendation ?? "Review trend movement."}</span></p>
      </div>
    </div>
  );
}

export function DailyLineChart({ data, color = "#6366f1", label = "Value" }: DailyLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis className="text-xs" tick={{ fontSize: 11 }} />
        <Tooltip content={<ExecutiveTooltip />} />
        {data.some((item) => item.goal != null) && <Legend />}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          name={label}
        />
        {data.some((item) => item.goal != null) && (
          <Line
            type="linear"
            dataKey="goal"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            activeDot={false}
            connectNulls={false}
            name="Daily target"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
