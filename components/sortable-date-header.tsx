"use client";

import { cn } from "@/lib/utils";

export type DateSortDirection = "asc" | "desc";

type SortableDateHeaderProps = {
  label: string;
  direction: DateSortDirection;
  active?: boolean;
  onToggle: () => void;
  className?: string;
};

export function dateTimeValue(value: unknown) {
  if (!value) return null;
  const time = new Date(value as string | number | Date).getTime();
  return Number.isNaN(time) ? null : time;
}

export function compareDateValues(
  a: unknown,
  b: unknown,
  direction: DateSortDirection
) {
  const aTime = dateTimeValue(a);
  const bTime = dateTimeValue(b);

  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;

  const result = aTime - bTime;
  return direction === "asc" ? result : -result;
}

export function SortableDateHeader({
  label,
  direction,
  active = true,
  onToggle,
  className,
}: SortableDateHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-left font-medium transition-colors hover:text-slate-900",
        active ? "text-blue-700" : "text-inherit",
        className
      )}
      aria-label={`Sort ${label} ${direction === "desc" ? "oldest to newest" : "newest to oldest"}`}
    >
      <span>{label}</span>
      <span className="inline-flex flex-col text-[9px] leading-[8px]" aria-hidden="true">
        <span className={cn(direction === "asc" && active ? "text-blue-700" : "text-slate-300")}>▲</span>
        <span className={cn(direction === "desc" && active ? "text-blue-700" : "text-slate-300")}>▼</span>
      </span>
    </button>
  );
}
