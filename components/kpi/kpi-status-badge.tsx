import { AlertTriangle, CheckCircle2, MinusCircle, Star, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KpiStatus } from "@/types/kpi";

const styles: Record<KpiStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  EXCEEDS_TARGET: { label: "Exceeds", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", icon: Star },
  MEETS_TARGET: { label: "Meets target", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200", icon: CheckCircle2 },
  NEAR_TARGET: { label: "Near target", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", icon: AlertTriangle },
  BELOW_TARGET: { label: "Below target", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", icon: XCircle },
  NO_DATA: { label: "No data", className: "bg-muted text-muted-foreground", icon: MinusCircle },
};

export function KpiStatusBadge({ status, compact = false }: { status: KpiStatus; compact?: boolean }) {
  const config = styles[status];
  const Icon = config.icon;
  return (
    <span
      title={config.label}
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap", config.className)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className={compact ? "sr-only" : undefined}>{config.label}</span>
    </span>
  );
}
