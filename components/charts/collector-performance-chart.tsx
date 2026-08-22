"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export interface CollectorPerformanceDatum {
  name: string;
  achievement: number | null;
  status: "on-track" | "needs-attention" | "critical" | "no-data";
}

const fillByStatus = {
  "on-track": "#34d399",
  "needs-attention": "#fbbf24",
  critical: "#fb7185",
  "no-data": "#64748b",
};

function TooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload as CollectorPerformanceDatum;
  return (
    <div className="rounded-lg border bg-card p-3 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{item.name}</p>
      <p className="mt-1 text-muted-foreground">
        Achievement: <span className="font-medium text-foreground">{item.achievement == null ? "Unavailable" : `${item.achievement.toFixed(1)}%`}</span>
      </p>
    </div>
  );
}

export function CollectorPerformanceChart({ data }: { data: CollectorPerformanceDatum[] }) {
  const reducedMotion = useReducedMotion();
  const height = Math.max(240, data.length * 42);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
          <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, (maximum: number) => Math.max(100, Math.ceil(maximum / 25) * 25)]} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
          <Tooltip content={<TooltipContent />} />
          <Bar dataKey={(item: CollectorPerformanceDatum) => item.achievement ?? 0} radius={[0, 4, 4, 0]} minPointSize={2} isAnimationActive={!reducedMotion} animationDuration={600} animationEasing="ease-out">
            {data.map((item) => <Cell key={item.name} fill={fillByStatus[item.status]} fillOpacity={item.status === "no-data" ? 0.45 : 0.8} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
