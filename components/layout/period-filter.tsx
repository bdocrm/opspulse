"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterPeriod } from "@/utils/kpi";

interface PeriodFilterProps {
  value: FilterPeriod;
  onChange: (v: FilterPeriod) => void;
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as FilterPeriod)}>
      <SelectTrigger className="w-[140px]">
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
