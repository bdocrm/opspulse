"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterPeriod } from "@/utils/kpi";
import { cn } from "@/lib/utils";

interface PeriodFilterProps {
  value: FilterPeriod;
  onChange: (v: FilterPeriod) => void;
  className?: string;
}

export function PeriodFilter({ value, onChange, className }: PeriodFilterProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as FilterPeriod)}>
      <SelectTrigger className={cn("w-[140px]", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="daily">Daily</SelectItem>
        <SelectItem value="weekly">Weekly</SelectItem>
        <SelectItem value="monthly">Monthly</SelectItem>
        <SelectItem value="yearly">Yearly</SelectItem>
      </SelectContent>
    </Select>
  );
}
