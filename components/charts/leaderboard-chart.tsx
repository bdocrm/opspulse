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

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"];

interface LeaderboardChartProps {
  data: {
    name: string;
    value: number;
  }[];
}

export function LeaderboardChart({ data }: LeaderboardChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 10, right: 10, left: 20, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" className="text-xs" tick={{ fontSize: 11 }} width={80} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
