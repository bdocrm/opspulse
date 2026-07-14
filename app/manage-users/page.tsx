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
import { CampaignMultiSelect } from "@/components/campaign-multi-select";
import { Trash2, Edit2, Plus, Search, AlertTriangle, Key } from "lucide-react";

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
  // Full multi-campaign assignment (always includes the primary campaign).
  campaigns?: { id: string; campaignName: string }[];
  campaignIds?: string[];
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
  campaignIds: string[];
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
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [passwordUserName, setPasswordUserName] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<{ [key: string]: string }>({});

  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    password: "",
    role: "AGENT",
    campaignIds: [],
    seatNumber: "",
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
      campaignIds: [],
      seatNumber: "",
      monthlyTarget: "",
    });
    setErrors({});
    setIsEditing(false);
    setEditingId(null);
  };

  const handleEditClick = (user: User) => {
    // Load the user's existing multi-campaign assignment. Fall back to the
    // legacy single campaignId so users created before this feature still
    // pre-select their campaign.
    const campaignIds =
      user.campaignIds && user.campaignIds.length > 0
        ? user.campaignIds
        : user.campaignId
        ? [user.campaignId]
        : [];
    setFormData({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      campaignIds,
      seatNumber: user.seatNumber?.toString() || "",
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
        // Multi-campaign assignment; the backend keeps the legacy primary
        // campaignId in sync from the first entry.
        campaignIds: formData.campaignIds,
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

  const handleChangePasswordClick = (user: User) => {
    setPasswordUserId(user.id);
    setPasswordUserName(user.name);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordErrors({});
    setPasswordDialogOpen(true);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrors({});

    const errors: { [key: string]: string } = {};
    if (!newPassword) {
      errors.newPassword = "Password is required";
    } else if (newPassword.length < 6) {
      errors.newPassword = "Password must be at least 6 characters";
    }

    if (!confirmPassword) {
      errors.confirmPassword = "Confirm password is required";
    }

    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch(`/api/users/${passwordUserId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update password");
      }

      addToast("success", `✅ Password for "${passwordUserName}" updated successfully!`);
      setPasswordDialogOpen(false);
      setPasswordUserId(null);
      setPasswordUserName("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error updating password";
      addToast("error", message);
      console.error(error);
    } finally {
      setPasswordLoading(false);
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

  const handleSelectAll = (list: User[]) => {
    const allSelected = list.length > 0 && list.every((u) => selectedUserIds.has(u.id));
    const newSelected = new Set(selectedUserIds);
    if (allSelected) {
      list.forEach((u) => newSelected.delete(u.id));
    } else {
      list.forEach((u) => newSelected.add(u.id));
    }
    setSelectedUserIds(newSelected);
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
      setBulkDeleteOpen(false);
      mutateUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error deleting users";
      addToast("error", message);
      console.error(error);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Duplicate monitoring: a user is flagged only when the same normalized name
  // appears more than once within the same campaign.
  const duplicateKeyForUser = (user: User) => {
    const normalizedName = user.name.trim().toLowerCase();
    const campaignKey = user.campaignId || "no-campaign";
    return `${normalizedName}::${campaignKey}`;
  };

  const nameCampaignCounts = users.reduce((acc, u) => {
    const key = duplicateKeyForUser(u);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const isDuplicateUser = (user: User) => (nameCampaignCounts[duplicateKeyForUser(user)] || 0) > 1;
  const duplicateCount = users.filter(isDuplicateUser).length;

  // Apply campaign filter, role filter, search, and duplicate filter.
  const filteredUsers = users.filter((user) => {
    if (selectedCampaignFilter) {
      const assigned =
        user.campaignIds && user.campaignIds.length > 0
          ? user.campaignIds
          : user.campaignId
          ? [user.campaignId]
          : [];
      if (!assigned.includes(selectedCampaignFilter)) return false;
    }
    if (roleFilter !== "all" && user.role !== roleFilter) return false;
    if (showDuplicatesOnly && !isDuplicateUser(user)) return false;
    const q = searchQuery.trim().toLowerCase();
    if (q && !`${user.name} ${user.email}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const allFilteredSelected =
    filteredUsers.length > 0 && filteredUsers.every((u) => selectedUserIds.has(u.id));

  if (status === "loading") {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Manage Users" subtitle="Create, update, and delete user accounts" />
        <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          className="gap-2"
          disabled={selectedUserIds.size === 0}
          onClick={() => setBulkDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Delete Selected ({selectedUserIds.size})
        </Button>
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
                    <SelectItem value="SMT">SMT</SelectItem>
                    <SelectItem value="OM">Operations Manager</SelectItem>
                    <SelectItem value="COLLECTOR">Collector</SelectItem>
                    <SelectItem value="AGENT">Agent</SelectItem>
                  </SelectContent>
                </Select>
                {errors.role && <p className="text-xs text-red-500">{errors.role}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaignIds">
                  Campaigns
                  {formData.campaignIds.length > 0 && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({formData.campaignIds.length} selected)
                    </span>
                  )}
                </Label>
                <CampaignMultiSelect
                  id="campaignIds"
                  campaigns={campaigns}
                  value={formData.campaignIds}
                  onChange={(ids) => setFormData({ ...formData, campaignIds: ids })}
                  placeholder="Select campaigns (optional)"
                />
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
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>Users ({filteredUsers.length})</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="w-full sm:w-40">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="CEO">CEO</SelectItem>
                  <SelectItem value="SMT">SMT</SelectItem>
                  <SelectItem value="OM">Operations Manager</SelectItem>
                  <SelectItem value="COLLECTOR">Collector</SelectItem>
                  <SelectItem value="AGENT">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant={showDuplicatesOnly ? "default" : "outline"}
              className={`gap-2 ${showDuplicatesOnly ? "" : "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"}`}
              onClick={() => setShowDuplicatesOnly((v) => !v)}
              title="Show only users with duplicate names in the same campaign"
            >
              <AlertTriangle className="h-4 w-4" />
              Duplicates ({duplicateCount})
            </Button>
            {campaigns.length > 0 && (
              <div className="w-full sm:w-48">
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
          </div>
        </CardHeader>
        <CardContent>
          {selectedUserIds.size > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-sm font-semibold text-red-700">
                {selectedUserIds.size} user(s) selected
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={() => handleSelectAll(filteredUsers)}
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
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user, index) => (
                    <TableRow key={user.id}>
                      <TableCell className="w-12 text-center text-sm text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell className="w-12">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => handleSelectUser(user.id)}
                          className="cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className={`font-medium ${isDuplicateUser(user) ? "text-red-600" : ""}`}>
                        <span className="inline-flex items-center gap-1.5">
                          {user.name}
                          {isDuplicateUser(user) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                              <AlertTriangle className="h-3 w-3" />
                              Duplicate
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell>
                        <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-primary/10 text-primary">
                          {user.role}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const list =
                            user.campaigns && user.campaigns.length > 0
                              ? user.campaigns
                              : user.campaign
                              ? [user.campaign]
                              : [];
                          if (list.length === 0) return "-";
                          return (
                            <div className="flex flex-wrap gap-1">
                              {list.map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                                >
                                  {c.campaignName}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </TableCell>
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
                          {(user.role === "COLLECTOR" || user.role === "CEO") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleChangePasswordClick(user)}
                              className="gap-1 text-blue-600 hover:text-blue-700"
                              title="Change password"
                            >
                              <Key className="h-4 w-4" />
                              Password
                            </Button>
                          )}
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

      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Delete Selected Users"
        description={`Are you sure you want to delete ${selectedUserIds.size} selected user(s)? This action cannot be undone.`}
        onConfirm={handleBulkDelete}
        isLoading={bulkDeleting}
        actionLabel="Delete Selected"
        isDangerous={true}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Password - {passwordUserName}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password *</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={passwordErrors.newPassword ? "border-red-500" : ""}
              />
              {passwordErrors.newPassword && (
                <p className="text-xs text-red-500">{passwordErrors.newPassword}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password *</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={passwordErrors.confirmPassword ? "border-red-500" : ""}
              />
              {passwordErrors.confirmPassword && (
                <p className="text-xs text-red-500">{passwordErrors.confirmPassword}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={passwordLoading}>
              {passwordLoading ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
