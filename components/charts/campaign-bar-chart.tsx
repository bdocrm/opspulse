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
    actual?: number;
    goal?: number | null;
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
        <p>Actual: <span className="font-medium text-foreground">{row.actual == null ? "N/A" : formatNumber(row.actual)}</span></p>
        <p>Achievement %: <span className="font-medium text-foreground">{Number(row.achievement ?? 0).toFixed(1)}%</span></p>
        <p>Rank: <span className="font-medium text-foreground">{row.rank ?? "N/A"}</span></p>
        <p>Status: <span className="font-medium text-foreground">{row.status ?? "N/A"}</span></p>
        <p>Recommendation: <span className="font-medium text-foreground">{row.recommendation ?? "Review campaign performance."}</span></p>
      </div>
    </div>
  );
}

export function CampaignBarChart({ data }: CampaignBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis className="text-xs" tick={{ fontSize: 11 }} />
        <Tooltip content={<ExecutiveTooltip />} />
        <Bar dataKey="achievement" radius={[4, 4, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell key={idx} fill={kpiColorHex(entry.achievement)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
