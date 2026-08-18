import { AlertCircle, CheckCircle2, CircleDashed, ShieldAlert, TrendingUp } from "lucide-react";
import type { ProductionStatus } from "@/types/production-monitoring";

const CONFIG = {
  ON_TRACK: { label: "On Track", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", icon: CheckCircle2 },
  NEAR_TARGET: { label: "Near Target", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200", icon: TrendingUp },
  AT_RISK: { label: "At Risk", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", icon: ShieldAlert },
  BELOW_TARGET: { label: "Below Target", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", icon: AlertCircle },
  NO_DATA: { label: "No Data", className: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300", icon: CircleDashed },
} as const;

export function ProductionStatusBadge({ status }: { status: ProductionStatus }) {
  const config = CONFIG[status];
  const Icon = config.icon;
  return <span className={`inline-flex whitespace-nowrap items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${config.className}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{config.label}</span>;
}
