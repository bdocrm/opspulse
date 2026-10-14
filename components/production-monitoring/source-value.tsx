"use client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function SourceValue({ label, field, provenance }: { label: string; field: string; provenance?: Record<string, unknown> }) {
  if (!provenance) return <>{label}</>;
  const value = (key: string) => provenance[key] == null ? "Unavailable" : typeof provenance[key] === "object" ? JSON.stringify(provenance[key]) : String(provenance[key]);
  return <Dialog><DialogTrigger asChild><button aria-label={`Inspect ${field} source`} className="underline decoration-dotted underline-offset-4 hover:text-primary">{label}</button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{field} source</DialogTitle><DialogDescription>Original source and applied normalization for this value.</DialogDescription></DialogHeader><dl className="grid grid-cols-[110px_1fr] gap-2 text-sm">{[["file", "Workbook"], ["sheet", "Worksheet"], ["row", "Source row"], ["address", "Cell"], ["batchId", "Import batch"], ["originalValue", "Original value"], ["formula", "Source formula"], ["normalizedValue", "Normalized"], ["calculatedValue", "Calculated"], ["origin", "Value origin"], ["transformation", "Transformation"], ["method", "Calculation"]].map(([key, name]) => <div key={key} className="contents"><dt className="text-muted-foreground">{name}</dt><dd className="break-all">{value(key)}</dd></div>)}</dl></DialogContent></Dialog>;
}
