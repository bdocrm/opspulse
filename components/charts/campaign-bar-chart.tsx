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
  LabelList,
} from "recharts";
import { kpiColorHex } from "@/utils/kpi";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatChartNumber } from "@/components/charts/chart-formatters";

interface CampaignBarChartProps {
  data: {
    name: string;
    achievement: number;
    actual?: number;
    goal?: number | null;
    rank?: number;
    status?: string;
    recommendation?: string;
    hasData?: boolean;
  }[];
}

function formatAchievement(value: number | string | null | undefined) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function ExecutiveTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const hasData = row.hasData !== false;

  return (
    <div className="min-w-[220px] rounded-md border bg-card p-3 text-xs shadow-sm">
      <p className="mb-2 font-semibold text-foreground">{row.name}</p>
      <div className="space-y-1 text-muted-foreground">
        <p>Name: <span className="font-medium text-foreground">{row.name}</span></p>
        <p>Goal: <span className="font-medium text-foreground">{row.goal == null ? "N/A" : formatChartNumber(row.goal)}</span></p>
        <p>Actual: <span className="font-medium text-foreground">{hasData && row.actual != null ? formatChartNumber(row.actual) : "No data"}</span></p>
        <p>Achievement %: <span className="font-medium text-foreground">{hasData ? `${Number(row.achievement ?? 0).toFixed(1)}%` : "N/A"}</span></p>
        <p>Rank: <span className="font-medium text-foreground">{row.rank ?? "N/A"}</span></p>
        <p>Status: <span className="font-medium text-foreground">{row.status ?? "N/A"}</span></p>
        <p>Recommendation: <span className="font-medium text-foreground">{row.recommendation ?? "Review campaign performance."}</span></p>
      </div>
    </div>
  );
}

export function CampaignBarChart({ data }: CampaignBarChartProps) {
  const reducedMotion = useReducedMotion();
  const minWidth = Math.max(900, data.length * 100);
  const renderAchievementLabel = ({ x, y, width, value, index }: any) => {
    const row = data[Number(index)];
    return (
      <text
        x={Number(x) + Number(width) / 2}
        y={Number(y) - 8}
        textAnchor="middle"
        className="fill-foreground"
        fontSize={11}
        fontWeight={600}
      >
        {row?.hasData === false ? "No data" : formatAchievement(value)}
      </text>
    );
  };

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth }}>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 32, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 11 }} interval={0} />
            <YAxis className="text-xs" tick={{ fontSize: 11 }} />
            <Tooltip content={<ExecutiveTooltip />} />
            <Bar dataKey="achievement" radius={[4, 4, 0, 0]} minPointSize={3} isAnimationActive={!reducedMotion} animationDuration={600} animationEasing="ease-out">
              {data.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.hasData === false ? "hsl(var(--muted-foreground))" : kpiColorHex(entry.achievement)}
                  fillOpacity={entry.hasData === false ? 0.35 : 1}
                />
              ))}
              <LabelList
                dataKey="achievement"
                position="top"
                content={renderAchievementLabel}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
