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
import { kpiColorHex } from "@/utils/kpi";

interface CampaignBarChartProps {
  data: {
    name: string;
    achievement: number;
  }[];
}

export function CampaignBarChart({ data }: CampaignBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis className="text-xs" tick={{ fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
          formatter={(value: number) => [`${value.toFixed(1)}%`, "Achievement"]}
        />
        <Bar dataKey="achievement" radius={[4, 4, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell key={idx} fill={kpiColorHex(entry.achievement)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
