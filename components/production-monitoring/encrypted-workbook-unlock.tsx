"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Preview } from "@/lib/smart-import/types";
const endpoint = "/api/production-monitoring/smart-import";
export function EncryptedWorkbookUnlock({ preview, disabled, onReceive }: { preview: Preview; disabled: boolean; onReceive: (preview: Preview) => void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (preview.status !== "DECRYPTING") return;
    const timer = setInterval(async () => {
      setNow(Date.now());
      try {
        const response = await fetch(`${endpoint}/${preview.id}`);
        if (response.ok && active.current) onReceive(await response.json());
      } catch { /* Keep the encrypted source retryable after its lease expires. */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [preview.id, preview.status, onReceive]);
  const leaseExpired = preview.status === "DECRYPTING" && now - Number(preview.inspection.metadata?.unlockStartedAt ?? 0) >= 90000;
  const unsupported = preview.status === "UNSUPPORTED_ENCRYPTION";
  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true); setError(""); setVisible(false);
    controller.current = new AbortController();
    const payload = JSON.stringify({ password });
    setPassword("");
    try {
      const response = await fetch(`${endpoint}/${preview.id}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: controller.current.signal });
      const result = await response.json();
      if (!active.current) return;
      if (response.ok) onReceive(result);
      else { if (result.preview) onReceive(result.preview); setError(result.error ?? "The workbook could not be unlocked."); }
    } catch { if (active.current) setError("The request was interrupted. Reload the workbook status before retrying."); }
    finally { if (active.current) setBusy(false); controller.current = null; }
  }
  async function cancel() {
    controller.current?.abort(); setPassword(""); setVisible(false);
    try {
      const response = await fetch(`${endpoint}/${preview.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      if (response.ok && active.current) onReceive({ ...preview, status: "CANCELLED" });
    } catch { if (active.current) setError("Cancellation could not be confirmed. Reload the workbook status."); }
  }
  return <div className="space-y-3 rounded-lg border border-amber-500/40 bg-muted/20 p-4"><h3 className="font-medium">{unsupported ? "Unsupported workbook encryption" : "Unlock encrypted workbook"}</h3><p className="break-all text-sm">{preview.inspection.fileName}</p><p className="text-xs text-muted-foreground">The encrypted original stays in import history. Your password is used for this request only. Review and confirmation are still required before importing records.</p>
    {unsupported ? <p role="alert" className="text-sm">{preview.inspection.warnings[0] ?? "Ask the owner for an encrypted XLSX workbook using supported AES encryption."}</p> : <form onSubmit={unlock} className="space-y-3"><label className="block text-sm">Workbook password<div className="mt-1 flex gap-2"><Input aria-label="Workbook password" type={visible ? "text" : "password"} autoComplete="off" maxLength={255} value={password} disabled={busy || disabled} onChange={event => setPassword(event.target.value)} /><Button type="button" variant="outline" aria-label={visible ? "Hide password" : "Show password"} disabled={busy || disabled} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div></label><Button type="submit" disabled={!password.trim() || busy || disabled || (preview.status === "DECRYPTING" && !leaseExpired)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? "Decrypting and extracting…" : "Unlock & Process Workbook"}</Button></form>}
    {(error || preview.lastError) && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error || preview.lastError}</p>}
    {busy && <p role="status" className="text-sm">DECRYPTING · Extracting all supported worksheets after unlock</p>}
    {preview.status === "DECRYPTING" && !busy && <p className="text-sm">An unlock request is in progress. Reload this workbook to check its status.</p>}
    <Button type="button" variant="outline" disabled={disabled} onClick={cancel}>Cancel workbook import</Button>
  </div>;
}
