"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/toast-provider";

const fetcher = async (url: string) => { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load campaign mappings."); return data; };
type Mapping = { id: string; sourceAccount: string; sourceCampaign: string; opsviewCampaignId: string; status: string; usageCount: number; updatedAt: string; opsviewCampaign: { campaignName: string }; updatedBy: { name: string }; audits: Array<{ id: string; action: string; createdAt: string; changedBy: { name: string } }> };

export default function CampaignMappingsPage() {
  const { addToast } = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ mappings: Mapping[]; canManage: boolean }>("/api/campaign-mappings?status=ALL", fetcher);
  const { data: options } = useSWR<{ campaigns: Array<{ id: string; campaignName: string }> }>("/api/production-monitoring/options", fetcher);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return (data?.mappings ?? []).filter((mapping) => !query || [mapping.sourceAccount, mapping.sourceCampaign, mapping.opsviewCampaign.campaignName].some((value) => value.toLowerCase().includes(query))); }, [data, search]);
  const update = async (mapping: Mapping, change: { status?: "ACTIVE" | "DISABLED"; opsviewCampaignId?: string }) => {
    const remapping = change.opsviewCampaignId && change.opsviewCampaignId !== mapping.opsviewCampaignId;
    if (remapping && !window.confirm(`Remap ${mapping.sourceAccount} + ${mapping.sourceCampaign}? Historical imported data will not be changed.`)) return;
    const response = await fetch(`/api/campaign-mappings/${mapping.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
    const result = await response.json();
    if (!response.ok) return addToast("error", result.error || "Campaign mapping could not be updated.");
    addToast("success", `Campaign mapping ${String(result.action).toLowerCase()}.`); await mutate();
  };
  return <div className="space-y-6">
    <Link href="/production-monitoring/admin"><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" />Production configuration</Button></Link>
    <div><h1 className="text-2xl font-bold">Campaign Mapping</h1><p className="text-sm text-muted-foreground">Manage account-scoped mappings without changing historical production records.</p></div>
    <div className="relative max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account, source, or OpsView campaign" /></div>
    {isLoading ? <Card><CardContent className="p-10 text-center">Loading mappings…</CardContent></Card> : error ? <Card><CardContent className="p-10 text-center text-red-700">{error.message}</CardContent></Card> : <Card><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-muted"><tr>{["Source Account", "Source Campaign", "OpsView Campaign", "Status", "Usage", "Updated", "Actions"].map((heading) => <th key={heading} className="p-3 text-left font-medium">{heading}</th>)}</tr></thead><tbody>{filtered.map((mapping) => <Fragment key={mapping.id}><tr className="border-t"><td className="p-3 font-medium">{mapping.sourceAccount}</td><td className="p-3">{mapping.sourceCampaign}</td><td className="p-3"><select value={targets[mapping.id] ?? mapping.opsviewCampaignId} onChange={(event) => setTargets((current) => ({ ...current, [mapping.id]: event.target.value }))} className="h-9 min-w-56 rounded-md border bg-background px-2" disabled={!data?.canManage}>{options?.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}</select></td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${mapping.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{mapping.status}</span></td><td className="p-3">{mapping.usageCount.toLocaleString()}</td><td className="p-3 text-xs">{new Date(mapping.updatedAt).toLocaleString()}<br /><span className="text-muted-foreground">by {mapping.updatedBy.name}</span></td><td className="p-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setExpanded(expanded === mapping.id ? null : mapping.id)}><History className="mr-1 h-3.5 w-3.5" />History</Button>{data?.canManage && targets[mapping.id] && targets[mapping.id] !== mapping.opsviewCampaignId && <Button size="sm" onClick={() => update(mapping, { opsviewCampaignId: targets[mapping.id] })}>Remap</Button>}{data?.canManage && <Button size="sm" variant="outline" onClick={() => update(mapping, { status: mapping.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>{mapping.status === "ACTIVE" ? "Disable" : "Enable"}</Button>}</div></td></tr>{expanded === mapping.id && <tr className="border-t bg-muted/30"><td colSpan={7} className="p-4"><p className="mb-2 font-medium">Recent history</p><div className="space-y-1 text-xs">{mapping.audits.length ? mapping.audits.map((audit) => <p key={audit.id}>{new Date(audit.createdAt).toLocaleString()} · {audit.action.replaceAll("_", " ")} · {audit.changedBy.name}</p>) : <p className="text-muted-foreground">No audit events.</p>}</div></td></tr>}</Fragment>)}</tbody></table>{!filtered.length && <p className="p-10 text-center text-muted-foreground">No campaign mappings found.</p>}</CardContent></Card>}
  </div>;
}
