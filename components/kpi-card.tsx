"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { kpiColorClass } from "@/utils/kpi";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  pct?: number; // achievement %
  icon?: LucideIcon;
}

export function KpiCard({ title, value, subtitle, pct, icon: Icon }: KpiCardProps) {
  const colorCls = pct !== undefined ? kpiColorClass(pct) : "";

  const TrendIcon =
    pct !== undefined
      ? pct >= 100
        ? TrendingUp
        : pct >= 80
        ? Minus
        : TrendingDown
      : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-xl sm:text-2xl font-bold">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
            {pct !== undefined && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                  colorCls
                )}
              >
                {TrendIcon && <TrendIcon className="h-3 w-3" />}
                {pct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
