"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Trash2, Edit2, Plus } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  seatNumber: number | null;
  campaignId: string | null;
  monthlyTarget: number | null;
  campaign?: { id: string; campaignName: string };
  createdAt: string;
}

interface Campaign {
  id: string;
  campaignName: string;
}

interface FormData {
  name: string;
  email: string;
  password: string;
  role: string;
  seatNumber: string;
  campaignId: string;
  monthlyTarget: string;
}

interface ValidationErrors {
  [key: string]: string;
}

const validateForm = (data: FormData, isEditing: boolean = false): ValidationErrors => {
  const errors: ValidationErrors = {};

  if (!data.name?.trim()) {
    errors.name = "Name is required";
  }

  if (!data.email?.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = "Invalid email format";
  }

  if (!isEditing && !data.password) {
    errors.password = "Password is required";
  } else if (!isEditing && data.password && data.password.length < 6) {
    errors.password = "Password must be at least 6 characters";
  }

  if (!data.role) {
    errors.role = "Role is required";
  }

  // Validate goal only for AGENT role
  if (data.role === "AGENT") {
    if (data.monthlyTarget && isNaN(Number(data.monthlyTarget))) {
      errors.monthlyTarget = "Goal must be a valid number";
    }
  }

  return errors;
};

export default function ManageUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { addToast } = useToast();

  const { data: usersData, mutate: mutateUsers } = useSWR("/api/users", fetcher);
  const { data: campaignsData } = useSWR("/api/campaigns", fetcher);

  const users: User[] = Array.isArray(usersData) ? usersData : [];
  const campaigns: Campaign[] = Array.isArray(campaignsData) ? campaignsData : [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; userId: string; name: string }>({
    open: false,
    userId: "",
    name: "",
  });
  const [deleting, setDeleting] = useState(false);
  const [selectedCampaignFilter, setSelectedCampaignFilter] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    password: "",
    role: "AGENT",
    seatNumber: "",
    campaignId: "",
    monthlyTarget: "",
  });

  // Check authorization
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || (session.user as any).role !== "CEO") {
      router.push("/dashboard");
    }
  }, [session, status, router]);

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      password: "",
      role: "AGENT",
      seatNumber: "",
      campaignId: "",
      monthlyTarget: "",
    });
    setErrors({});
    setIsEditing(false);
    setEditingId(null);
  };

  const handleEditClick = (user: User) => {
    setFormData({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      seatNumber: user.seatNumber?.toString() || "",
      campaignId: user.campaignId || "",
      monthlyTarget: user.monthlyTarget?.toString() || "",
    });
    setIsEditing(true);
    setEditingId(user.id);
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const formErrors = validateForm(formData, isEditing);
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      return;
    }

    setLoading(true);

    try {
      const payload: any = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        seatNumber: formData.seatNumber ? parseInt(formData.seatNumber) : null,
        campaignId: formData.campaignId || null,
        monthlyTarget: formData.monthlyTarget ? parseFloat(formData.monthlyTarget) : null,
      };

      // Add password only if creating new user or if password field is filled
      if (!isEditing && formData.password) {
        payload.password = formData.password;
      }

      const url = isEditing ? `/api/users/${editingId}` : "/api/users";
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Failed to ${isEditing ? "update" : "create"} user`);
      }

      addToast("success", `✅ User "${formData.name}" ${isEditing ? "updated" : "created"} successfully!`);
      setDialogOpen(false);
      resetForm();
      mutateUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error saving user";
      addToast("error", message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (user: User) => {
    setDeleteDialog({
      open: true,
      userId: user.id,
      name: user.name,
    });
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${deleteDialog.userId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete user");
      }

      addToast("success", `✅ User "${deleteDialog.name}" deleted successfully`);
      setDeleteDialog({ open: false, userId: "", name: "" });
      mutateUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error deleting user";
      addToast("error", message);
      console.error(error);
    } finally {
      setDeleting(false);
    }
  };

  const handleSelectUser = (userId: string) => {
    const newSelected = new Set(selectedUserIds);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUserIds(newSelected);
  };

  const handleSelectAll = (filteredUsers: User[]) => {
    if (selectedUserIds.size === filteredUsers.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map((u) => u.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUserIds.size === 0) {
      addToast("error", "No users selected");
      return;
    }

    setBulkDeleting(true);
    try {
      const res = await fetch("/api/users/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: Array.from(selectedUserIds),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete users");
      }

      const data = await res.json();
      addToast("success", `✅ ${data.data.deletedCount} user(s) deleted successfully`);
      setSelectedUserIds(new Set());
      mutateUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error deleting users";
      addToast("error", message);
      console.error(error);
    } finally {
      setBulkDeleting(false);
    }
  };

  if (status === "loading") {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Manage Users" subtitle="Create, update, and delete user accounts" />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit User" : "Add New User"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="Full name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={errors.name ? "border-red-500" : ""}
                />
                {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={errors.email ? "border-red-500" : ""}
                />
                {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
              </div>

              {!isEditing && (
                <div className="space-y-2">
                  <Label htmlFor="password">Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Min 6 characters"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={errors.password ? "border-red-500" : ""}
                  />
                  {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                <Select value={formData.role} onValueChange={(val) => setFormData({ ...formData, role: val })}>
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CEO">CEO</SelectItem>
                    <SelectItem value="OM">Operations Manager</SelectItem>
                    <SelectItem value="COLLECTOR">Collector</SelectItem>
                    <SelectItem value="AGENT">Agent</SelectItem>
                  </SelectContent>
                </Select>
                {errors.role && <p className="text-xs text-red-500">{errors.role}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaignId">Campaign</Label>
                <Select value={formData.campaignId} onValueChange={(val) => setFormData({ ...formData, campaignId: val })}>
                  <SelectTrigger id="campaignId">
                    <SelectValue placeholder="Select campaign (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.campaignName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="seatNumber">Seat Number</Label>
                <Input
                  id="seatNumber"
                  type="number"
                  placeholder="e.g., 1, 2, 3..."
                  value={formData.seatNumber}
                  onChange={(e) => setFormData({ ...formData, seatNumber: e.target.value })}
                />
              </div>

              {formData.role === "AGENT" && (
                <div className="space-y-2">
                  <Label htmlFor="monthlyTarget">Monthly Goal (Agent)</Label>
                  <Input
                    id="monthlyTarget"
                    type="number"
                    placeholder="e.g., 1000"
                    step="0.01"
                    value={formData.monthlyTarget}
                    onChange={(e) => setFormData({ ...formData, monthlyTarget: e.target.value })}
                    className={errors.monthlyTarget ? "border-red-500" : ""}
                  />
                  {errors.monthlyTarget && <p className="text-xs text-red-500">{errors.monthlyTarget}</p>}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving..." : isEditing ? "Update User" : "Create User"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Users</CardTitle>
          {campaigns.length > 0 && (
            <div className="w-48">
              <Select 
                value={selectedCampaignFilter || "all"} 
                onValueChange={(val) => setSelectedCampaignFilter(val === "all" ? null : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Campaigns</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.campaignName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {selectedUserIds.size > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
              <span className="text-sm font-semibold text-red-700">
                {selectedUserIds.size} user(s) selected
              </span>
              <Button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="bg-red-600 hover:bg-red-700 gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {bulkDeleting ? "Deleting..." : "Delete Selected"}
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={selectedUserIds.size > 0 && selectedUserIds.size === users.filter((user) => selectedCampaignFilter ? user.campaignId === selectedCampaignFilter : true).length}
                      onChange={() => handleSelectAll(users.filter((user) => selectedCampaignFilter ? user.campaignId === selectedCampaignFilter : true))}
                      className="cursor-pointer"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Seat</TableHead>
                  <TableHead>Goal</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  users
                    .filter((user) => {
                      // Filter by campaign if selected
                      if (selectedCampaignFilter) {
                        return user.campaignId === selectedCampaignFilter;
                      }
                      return true;
                    })
                    .map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="w-12">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => handleSelectUser(user.id)}
                          className="cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell>
                        <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-primary/10 text-primary">
                          {user.role}
                        </span>
                      </TableCell>
                      <TableCell>{user.campaign?.campaignName || "-"}</TableCell>
                      <TableCell className="text-center">{user.seatNumber || "-"}</TableCell>
                      <TableCell>{user.monthlyTarget ? user.monthlyTarget.toLocaleString() : "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditClick(user)}
                            className="gap-1"
                          >
                            <Edit2 className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(user)}
                            className="gap-1 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete User"
        description={`Are you sure you want to delete "${deleteDialog.name}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        isLoading={deleting}
        actionLabel="Delete"
        isDangerous={true}
        onCancel={() => setDeleteDialog({ open: false, userId: "", name: "" })}
      />
    </div>
  );
}
