import { Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type LoadingProps = {
  className?: string;
  label?: string;
};

function LoadingRegion({
  children,
  className,
  label = "Loading content",
}: LoadingProps & { children: React.ReactNode }) {
  return (
    <div
      className={cn("motion-fade-in", className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function LoadingState({
  className,
  label = "Loading content…",
}: LoadingProps) {
  return (
    <div
      className={cn(
        "motion-fade-in flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
        <span className="absolute inset-1 rounded-full border border-primary/15" aria-hidden="true" />
        <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
  label = "Loading table",
}: LoadingProps & { rows?: number; columns?: number }) {
  return (
    <LoadingRegion className={cn("space-y-3", className)} label={label}>
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={`header-${index}`} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={`row-${rowIndex}`} className="flex gap-4 py-1">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={`cell-${rowIndex}-${columnIndex}`}
              className={cn("h-4 flex-1", columnIndex === 0 && "max-w-40")}
            />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

export function CardSkeleton({ className, label = "Loading card" }: LoadingProps) {
  return (
    <LoadingRegion
      className={cn("space-y-4 rounded-xl border bg-card p-5 shadow-sm", className)}
      label={label}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
      <Skeleton className="h-3 w-36" />
    </LoadingRegion>
  );
}

export function ChartSkeleton({ className, label = "Loading chart" }: LoadingProps) {
  return (
    <LoadingRegion
      className={cn("space-y-5 rounded-xl border bg-card p-5 shadow-sm", className)}
      label={label}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-52 max-w-full" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </LoadingRegion>
  );
}

export function FormSkeleton({ className, label = "Loading form" }: LoadingProps) {
  return (
    <LoadingRegion
      className={cn("mx-auto w-full max-w-3xl space-y-6 p-6", className)}
      label={label}
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-10 w-32" />
      </div>
    </LoadingRegion>
  );
}

export function DashboardSkeleton({
  className,
  label = "Loading dashboard",
}: LoadingProps) {
  return (
    <LoadingRegion className={cn("space-y-6 p-6", className)} label={label}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <CardSkeleton key={`kpi-${index}`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <TableSkeleton rows={6} columns={5} />
      </div>
    </LoadingRegion>
  );
}

export function PageSkeleton({
  className,
  label = "Loading page",
}: LoadingProps) {
  return (
    <LoadingRegion className={cn("space-y-6 p-6", className)} label={label}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row">
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-10 w-32" />
        </div>
        <TableSkeleton rows={7} columns={5} />
      </div>
    </LoadingRegion>
  );
}

export function ListSkeleton({
  items = 5,
  className,
  label = "Loading list",
}: LoadingProps & { items?: number }) {
  return (
    <LoadingRegion className={cn("space-y-3", className)} label={label}>
      {Array.from({ length: items }).map((_, index) => (
        <div key={`list-item-${index}`} className="flex gap-3 rounded-lg border p-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}
