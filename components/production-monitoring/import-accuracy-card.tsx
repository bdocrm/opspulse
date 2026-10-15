import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { importAccuracy } from "@/lib/smart-import/accuracy";
import type { Preview } from "@/lib/smart-import/types";

const count = (value: number | null) => value == null ? "Pending" : value.toLocaleString("en-US");
export function ImportAccuracyCard({ preview }: { preview: Preview }) {
  const accuracy = preview.accuracy ?? importAccuracy(preview.inspection, preview.reconciliation);
  const verified = accuracy.status === "VERIFIED";
  const failed = accuracy.status === "FAILED";
  const label = verified ? "100% - Verified" : failed ? "Verification failed" : accuracy.status === "NO_DATA" ? "No source data" : "Pending verification";
  return <Card aria-label="Import accuracy" className={verified ? "border-emerald-500/40" : failed ? "border-red-500/40" : ""}>
    <CardHeader><CardTitle>Import accuracy</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p role="status" className={`text-2xl font-semibold ${verified ? "text-emerald-600 dark:text-emerald-400" : failed ? "text-red-600 dark:text-red-400" : ""}`}>{label}</p>
      <p className="text-sm text-muted-foreground">100% means all source cells and rows were saved and their contents verified against the extracted Excel file. Campaign mapping and the correctness of formulas in the original file are separate checks.</p>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <p>Cells saved: <strong>{count(accuracy.storedCells)} / {count(accuracy.sourceCells)}</strong></p>
        <p>Rows saved: <strong>{count(accuracy.storedRows)} / {count(accuracy.sourceRows)}</strong></p>
        <p>Worksheets verified: <strong>{accuracy.totalSheets == null ? "Pending" : `${accuracy.verifiedSheets} / ${accuracy.totalSheets}`}</strong></p>
      </div>
      {failed && <p className="text-sm text-red-600 dark:text-red-400">The saved data did not pass verification. Import is blocked until the workbook can be read and verified successfully.</p>}
    </CardContent>
  </Card>;
}
