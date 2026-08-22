"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export interface KpiTrendPoint {
  period: string;
  actual: number | null;
  goal: number | null;
}

export function KpiTrendChart({ data, unit = "%" }: { data: KpiTrendPoint[]; unit?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="h-56 w-full" aria-label="KPI actual and goal trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={48} unit={unit} />
          <Tooltip formatter={(value: number) => [`${Number(value).toFixed(2)}${unit}`, ""]} />
          <Legend />
          <Line type="monotone" dataKey="actual" name="Actual" stroke="#2563eb" strokeWidth={2.5} connectNulls isAnimationActive={!reducedMotion} animationDuration={600} animationEasing="ease-out" />
          <Line type="monotone" dataKey="goal" name="Goal" stroke="#94a3b8" strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={!reducedMotion} animationDuration={600} animationEasing="ease-out" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
