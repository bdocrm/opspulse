"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";

interface ReportPeriodSelectorProps {
  year: number;
  month: number;
  allMonths: boolean;
  onChange: (year: number, month: number, allMonths: boolean) => void;
  className?: string;
}

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((response) => response.json());

export function ReportPeriodSelector({
  year,
  month,
  allMonths,
  onChange,
  className = "h-10 min-w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm",
}: ReportPeriodSelectorProps) {
  const { data } = useSWR("/api/reports/campaign-performance/periods", fetcher);
  const periods = useMemo<Array<{ year: number; month: number }>>(
    () => data?.periods ?? [],
    [data?.periods]
  );
  const value = allMonths ? "all" : `${year}-${String(month).padStart(2, "0")}`;

  useEffect(() => {
    if (allMonths || periods.length === 0) return;
    const selectedExists = periods.some((period) => period.year === year && period.month === month);
    if (!selectedExists) onChange(periods[0].year, periods[0].month, false);
  }, [allMonths, month, onChange, periods, year]);

  return (
    <select
      aria-label="Reporting period"
      value={value}
      onChange={(event) => {
        if (event.target.value === "all") {
          onChange(year, month, true);
          return;
        }
        const [nextYear, nextMonth] = event.target.value.split("-").map(Number);
        onChange(nextYear, nextMonth, false);
      }}
      className={className}
    >
      <option value="all">All Months</option>
      {periods.map((period) => {
        const optionValue = `${period.year}-${String(period.month).padStart(2, "0")}`;
        const label = new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));
        return <option key={optionValue} value={optionValue}>{label}</option>;
      })}
    </select>
  );
}
