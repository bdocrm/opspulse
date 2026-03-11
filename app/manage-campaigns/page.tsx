"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageTitle } from "@/components/layout/page-title";
import { Trash2, Edit2, Plus } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Campaign {
  id: string;
  campaignName: string;
  goalType: string;
  monthlyGoal: number;
  kpiMetric: string;
  createdAt: string;
}

// Form types and validation
type FormData = {
  campaignName: string;
  goalType: string;
  monthlyGoal: string;
  kpiMetric: string;
};

type ValidationErrors = {
  campaignName?: string;
  monthlyGoal?: string;
};

const validateForm = (data: FormData): ValidationErrors => {
  const errors: ValidationErrors = {};
  
  if (!data.campaignName?.trim()) {
    errors.campaignName = "Campaign name is required";
  } else if (data.campaignName.trim().length < 3) {
    errors.campaignName = "Campaign name must be at least 3 characters";
  }
  
  const goal = parseFloat(data.monthlyGoal);
  if (!data.monthlyGoal) {
    errors.monthlyGoal = "Monthly goal is required";
  } else if (isNaN(goal)) {
    errors.monthlyGoal = "Monthly goal must be a valid number";
  } else if (goal <= 0) {
    errors.monthlyGoal = "Monthly goal must be greater than 0";
  } else if (goal > 999999999999) {
    errors.monthlyGoal = "Monthly goal is too large";
  }
  
  return errors;
};

export default function ManageCampaignsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { addToast } = useToast();
  const { data, mutate } = useSWR("/api/campaigns", fetcher);
  const campaigns: Campaign[] = Array.isArray(data) ? data : [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [formData, setFormData] = useState<FormData>({
    campaignName: "",
    goalType: "sales",
    monthlyGoal: "",
    kpiMetric: "transmittals",
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; campaignId: string; name: string }>({
    open: false,
    campaignId: "",
    name: "",
  });
  const [deleting, setDeleting] = useState(false);

  // Check authorization
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || (session.user as any).role !== "CEO") {
      router.push("/dashboard");
    }
  }, [session, status, router]);

  const resetForm = () => {
    setFormData({
      campaignName: "",
      goalType: "sales",
      monthlyGoal: "",
      kpiMetric: "transmittals",
    });
    setErrors({});
    setIsEditing(false);
    setEditingId(null);
  };

  const handleEditClick = (campaign: Campaign) => {
    setFormData({
      campaignName: campaign.campaignName,
      goalType: campaign.goalType,
      monthlyGoal: campaign.monthlyGoal.toString(),
      kpiMetric: campaign.kpiMetric,
    });
    setIsEditing(true);
    setEditingId(campaign.id);
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate form
    const formErrors = validateForm(formData);
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      return;
    }

    setLoading(true);

    try {
      const url = isEditing ? `/api/campaigns/${editingId}` : "/api/campaigns";
      const method = isEditing ? "PATCH" : "POST";
      const payload = {
        ...formData,
        monthlyGoal: parseFloat(formData.monthlyGoal),
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Failed to ${isEditing ? "update" : "create"} campaign`);
      }

      addToast("success", `✅ Campaign "${formData.campaignName}" ${isEditing ? "updated" : "created"} successfully!`);
      setDialogOpen(false);
      resetForm();
      mutate();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Error ${isEditing ? "updating" : "creating"} campaign`;
      addToast("error", message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (campaign: Campaign) => {
    setDeleteDialog({
      open: true,
      campaignId: campaign.id,
      name: campaign.campaignName,
    });
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${deleteDialog.campaignId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete campaign");
      }

      addToast("success", `✅ Campaign "${deleteDialog.name}" deleted successfully`);
      setDeleteDialog({ open: false, campaignId: "", name: "" });
      mutate();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error deleting campaign";
      addToast("error", message);
      console.error(error);
    } finally {
      setDeleting(false);
    }
  };

  if (status === "loading") {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Manage Campaigns" subtitle="Create, update, and delete campaigns" />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit Campaign" : "Add New Campaign"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="campaignName">Campaign Name *</Label>
                <Input
                  id="campaignName"
                  placeholder="e.g., BPI PA OUTBOUND"
                  value={formData.campaignName}
                  onChange={(e) => setFormData({ ...formData, campaignName: e.target.value })}
                  className={errors.campaignName ? "border-red-500" : ""}
                />
                {errors.campaignName && <p className="text-xs text-red-500">{errors.campaignName}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="goalType">Goal Type *</Label>
                <Select value={formData.goalType} onValueChange={(val) => setFormData({ ...formData, goalType: val })}>
                  <SelectTrigger id="goalType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales">Gross Transmittals</SelectItem>
                    <SelectItem value="activation">Activations</SelectItem>
                    <SelectItem value="quality">Quality Rate</SelectItem>
                    <SelectItem value="conversion">Conversion Rate</SelectItem>
                    <SelectItem value="booking">Booking</SelectItem>
                    <SelectItem value="tap">Tap Rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthlyGoal">Monthly Goal *</Label>
                <Input
                  id="monthlyGoal"
                  type="number"
                  placeholder="e.g., 1000"
                  step="0.01"
                  value={formData.monthlyGoal}
                  onChange={(e) => setFormData({ ...formData, monthlyGoal: e.target.value })}
                  className={errors.monthlyGoal ? "border-red-500" : ""}
                />
                {errors.monthlyGoal && <p className="text-xs text-red-500">{errors.monthlyGoal}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="kpiMetric">KPI Metric *</Label>
                <Select value={formData.kpiMetric} onValueChange={(val) => setFormData({ ...formData, kpiMetric: val })}>
                  <SelectTrigger id="kpiMetric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transmittals">Transmittals</SelectItem>
                    <SelectItem value="activations">Activations</SelectItem>
                    <SelectItem value="qualityRate">Quality Rate (%)</SelectItem>
                    <SelectItem value="conversionRate">Conversion Rate (%)</SelectItem>
                    <SelectItem value="booked">Booked</SelectItem>
                    <SelectItem value="tapRate">Tap Rate (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving..." : isEditing ? "Update Campaign" : "Create Campaign"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardHeader>
          <CardTitle>Campaigns ({campaigns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No campaigns yet. Create your first campaign!</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">Campaign Name</th>
                    <th className="text-left py-3 px-4">Goal Type</th>
                    <th className="text-right py-3 px-4">Monthly Goal</th>
                    <th className="text-left py-3 px-4">KPI Metric</th>
                    <th className="text-left py-3 px-4">Created</th>
                    <th className="text-right py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4 font-medium">{campaign.campaignName}</td>
                      <td className="py-3 px-4 capitalize">{campaign.goalType}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">
                        {typeof campaign.monthlyGoal === "number" ? campaign.monthlyGoal.toLocaleString() : campaign.monthlyGoal}
                      </td>
                      <td className="py-3 px-4">{campaign.kpiMetric}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {new Date(campaign.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditClick(campaign)}
                            className="gap-1"
                          >
                            <Edit2 className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(campaign)}
                            className="gap-1 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete Campaign"
        description={`Are you sure you want to delete "${deleteDialog.name}"? This action cannot be undone and all associated data will be removed.`}
        onConfirm={handleDeleteConfirm}
        isLoading={deleting}
        actionLabel="Delete"
        isDangerous={true}
        onCancel={() => setDeleteDialog({ open: false, campaignId: "", name: "" })}
      />
    </div>
  );
}
