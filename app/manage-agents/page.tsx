"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { PageTitle } from "@/components/layout/page-title";
import { AlertCircle, CheckCircle } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  email: string;
  seatNumber: number | null;
  campaignId: string | null;
  campaign?: { id: string; campaignName: string };
}

interface Campaign {
  id: string;
  campaignName: string;
}

interface AgentCampaignAssignment {
  agentId: string;
  campaignIds: string[];
}

export default function ManageAgentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [selectedCampaigns, setSelectedCampaigns] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Check authorization
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && session?.user?.role !== "CEO" && session?.user?.role !== "OM") {
      router.push("/collector");
    }
  }, [status, session, router]);

  // Fetch agents and campaigns
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [agentsRes, campaignsRes] = await Promise.all([
          fetch("/api/users?role=AGENT"),
          fetch("/api/campaigns"),
        ]);

        if (agentsRes.ok) {
          const agentsData = await agentsRes.json();
          setAgents(agentsData);
          
          // Initialize selected campaigns
          const initial: Record<string, string[]> = {};
          // We'll need to fetch agent campaign assignments separately
          setSelectedCampaigns(initial);
        }

        if (campaignsRes.ok) {
          const campaignsData = await campaignsRes.json();
          setCampaigns(campaignsData.campaigns || []);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setMessage({ type: "error", text: "Failed to load data" });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleEditAgent = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent?.campaign) {
      setSelectedCampaigns((prev) => ({
        ...prev,
        [agentId]: [agent.campaign!.id],
      }));
    }
    setEditingAgent(agentId);
  };

  const handleSaveAssignments = async () => {
    if (!editingAgent) return;

    setSaving(true);
    try {
      const campaignIds = selectedCampaigns[editingAgent] || [];
      
      // Update agent campaign assignment
      const response = await fetch(`/api/users/${editingAgent}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignIds[0] || null,
        }),
      });

      if (response.ok) {
        setMessage({ type: "success", text: "Agent assignments updated successfully" });
        setEditingAgent(null);
        
        // Refresh agent data
        const refreshRes = await fetch("/api/users?role=AGENT");
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setAgents(data);
        }
      } else {
        setMessage({ type: "error", text: "Failed to update assignments" });
      }
    } catch (error) {
      console.error("Error saving assignments:", error);
      setMessage({ type: "error", text: "An error occurred while saving" });
    } finally {
      setSaving(false);
    }
  };

  const toggleCampaignSelection = (agentId: string, campaignId: string) => {
    setSelectedCampaigns((prev) => {
      const current = prev[agentId] || [];
      const updated = current.includes(campaignId)
        ? current.filter((id) => id !== campaignId)
        : [...current, campaignId];
      return { ...prev, [agentId]: updated };
    });
  };

  if (status === "loading" || loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <PageTitle title="Manage Agents" />

      {message && (
        <div
          className={`flex gap-2 p-4 rounded-lg ${
            message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agent Campaign Allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Seat Number</TableHead>
                  <TableHead>Assigned Campaign</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>{agent.email}</TableCell>
                    <TableCell>{agent.seatNumber || "-"}</TableCell>
                    <TableCell>{agent.campaign?.campaignName || "Unassigned"}</TableCell>
                    <TableCell>
                      <Dialog open={editingAgent === agent.id} onOpenChange={(open) => !open && setEditingAgent(null)}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => handleEditAgent(agent.id)}>
                            Edit
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Assign Campaigns to {agent.name}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-3">
                              {campaigns.map((campaign) => (
                                <div key={campaign.id} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`campaign-${campaign.id}`}
                                    checked={(selectedCampaigns[agent.id] || []).includes(campaign.id)}
                                    onCheckedChange={() => toggleCampaignSelection(agent.id, campaign.id)}
                                  />
                                  <Label
                                    htmlFor={`campaign-${campaign.id}`}
                                    className="text-sm font-normal cursor-pointer"
                                  >
                                    {campaign.campaignName}
                                  </Label>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button variant="outline" onClick={() => setEditingAgent(null)}>
                                Cancel
                              </Button>
                              <Button onClick={handleSaveAssignments} disabled={saving}>
                                {saving ? "Saving..." : "Save"}
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campaign Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((campaign) => {
              const agentsInCampaign = agents.filter(
                (agent) => agent.campaignId === campaign.id
              );
              return (
                <Card key={campaign.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4">
                    <h4 className="font-semibold text-sm">{campaign.campaignName}</h4>
                    <p className="text-xs text-gray-600 mt-2">{agentsInCampaign.length} agents assigned</p>
                    {agentsInCampaign.length > 0 && (
                      <ul className="text-xs mt-2 space-y-1">
                        {agentsInCampaign.map((agent) => (
                          <li key={agent.id} className="text-gray-700">
                            • {agent.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
