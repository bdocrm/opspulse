"use client";

import { useCallback, useEffect, useMemo } from "react";
import useSWR from "swr";
import { useReportPeriod } from "@/components/report-period-provider";

interface ReportPeriodSelectorProps {
  /** When omitted, the selector reads/writes the global report-period context. */
  year?: number;
  month?: number;
  allMonths?: boolean;
  onChange?: (year: number, month: number, allMonths: boolean) => void;
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
  const context = useReportPeriod();
  // Prefer explicitly-passed (controlled) props; otherwise use the shared context.
  const effectiveYear = year ?? context.year;
  const effectiveMonth = month ?? context.month;
  const effectiveAllMonths = allMonths ?? context.allMonths;

  const commit = useCallback(
    (nextYear: number, nextMonth: number, nextAllMonths: boolean) => {
      if (onChange) {
        onChange(nextYear, nextMonth, nextAllMonths);
      } else {
        context.setPeriod(nextYear, nextMonth, nextAllMonths);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange, context.setPeriod]
  );

  const { data } = useSWR("/api/reports/campaign-performance/periods", fetcher);
  const periods = useMemo<Array<{ year: number; month: number }>>(
    () => data?.periods ?? [],
    [data?.periods]
  );
  const value = effectiveAllMonths ? "all" : `${effectiveYear}-${String(effectiveMonth).padStart(2, "0")}`;

  useEffect(() => {
    if (effectiveAllMonths || periods.length === 0) return;
    const selectedExists = periods.some(
      (period) => period.year === effectiveYear && period.month === effectiveMonth
    );
    if (!selectedExists) commit(periods[0].year, periods[0].month, false);
  }, [effectiveAllMonths, effectiveMonth, effectiveYear, periods, commit]);

  return (
    <select
      aria-label="Reporting period"
      value={value}
      onChange={(event) => {
        if (event.target.value === "all") {
          commit(effectiveYear, effectiveMonth, true);
          return;
        }
        const [nextYear, nextMonth] = event.target.value.split("-").map(Number);
        commit(nextYear, nextMonth, false);
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
