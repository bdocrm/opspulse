"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ALL_MONTHS, monthName, monthSelectionLabel, normalizeMonthSelection } from "@/lib/month-selection";
import { CalendarDays, Check } from "lucide-react";

type Props = {
  selectedMonths: number[];
  availableMonths: number[];
  onChange: (months: number[]) => void;
  latestAvailableMonth?: number;
};

export function MonthMultiSelect({ selectedMonths, availableMonths, onChange, latestAvailableMonth }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = normalizeMonthSelection(selectedMonths);
  const available = new Set(normalizeMonthSelection(availableMonths));
  const setMonths = (months: number[]) => onChange(normalizeMonthSelection(months));
  const toggleMonth = (month: number) => setMonths(selected.includes(month) ? selected.filter((item) => item !== month) : [...selected, month]);
  const quarter = (start: number) => [start, start + 1, start + 2];
  const ytdEnd = latestAvailableMonth && latestAvailableMonth >= 1 && latestAvailableMonth <= 12 ? latestAvailableMonth : new Date().getMonth() + 1;

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="flex h-10 min-w-44 cursor-pointer list-none items-center justify-between gap-3 rounded-md border bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" />{monthSelectionLabel(selected)}</span>
        <span aria-hidden="true" className="text-xs text-muted-foreground transition-transform group-open:rotate-180">▼</span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Select</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setMonths(ALL_MONTHS)}>All</Button>
          {[1, 4, 7, 10].map((start, index) => <Button key={start} type="button" size="sm" variant="outline" onClick={() => setMonths(quarter(start))}>Q{index + 1}</Button>)}
          <Button type="button" size="sm" variant="outline" onClick={() => setMonths(ALL_MONTHS.slice(0, ytdEnd))}>YTD</Button>
        </div>
        <div className="my-3 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {ALL_MONTHS.map((month) => {
            const checked = selected.includes(month);
            const hasData = available.has(month);
            return (
              <label key={month} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent">
                <input type="checkbox" checked={checked} onChange={() => toggleMonth(month)} className="sr-only" />
                <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                <span className="flex-1">{monthName(month)}</span>
                <span className={`h-2 w-2 rounded-full ${hasData ? "bg-emerald-500" : "bg-muted-foreground/25"}`} title={hasData ? "Data available" : "No imported data"} aria-label={hasData ? "Data available" : "No imported data"} />
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setMonths([])}>Clear All</Button>
          <Button type="button" size="sm" disabled={!selected.length} onClick={() => { detailsRef.current?.removeAttribute("open"); }}>Apply</Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground"><span className="text-emerald-500">●</span> Data available <span className="ml-2">● No imported data</span></p>
      </div>
    </details>
  );
}
