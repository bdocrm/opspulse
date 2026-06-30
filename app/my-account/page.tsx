"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/toast-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Key, Save } from "lucide-react";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ValidationErrors {
  [key: string]: string;
}

export default function MyAccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { addToast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});

  const [formData, setFormData] = useState({
    name: "",
    email: "",
  });

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<ValidationErrors>({});

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) {
      router.push("/login");
      return;
    }
    fetchProfile();
  }, [session, status, router]);

  const fetchProfile = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        throw new Error("Failed to fetch profile");
      }
      const data = await res.json();
      setProfile(data);
      setFormData({
        name: data.name,
        email: data.email,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error loading profile";
      addToast("error", message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (): ValidationErrors => {
    const errors: ValidationErrors = {};

    if (!formData.name?.trim()) {
      errors.name = "Name is required";
    }

    if (!formData.email?.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = "Invalid email format";
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const formErrors = validateForm();
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update profile");
      }

      addToast("success", "✅ Profile updated successfully!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error updating profile";
      addToast("error", message);
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrors({});

    const errors: ValidationErrors = {};
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
      const res = await fetch("/api/auth/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to change password");
      }

      addToast("success", "✅ Password changed successfully!");
      setPasswordDialogOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error changing password";
      addToast("error", message);
      console.error(error);
    } finally {
      setPasswordLoading(false);
    }
  };

  const canChangePassword = profile?.role === "CEO" || profile?.role === "COLLECTOR";

  if (status === "loading" || loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!profile) {
    return <div className="p-6">Unable to load profile</div>;
  }

  return (
    <div className="space-y-6">
      <PageTitle title="My Account" subtitle="View and manage your profile" />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
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
              <Label htmlFor="email">Email</Label>
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

            <div className="space-y-2">
              <Label>Role</Label>
              <div className="px-3 py-2 bg-gray-100 rounded border border-gray-200">
                <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-primary/10 text-primary">
                  {profile.role}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>

              {canChangePassword && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPasswordDialogOpen(true)}
                  className="gap-2"
                >
                  <Key className="h-4 w-4" />
                  Change Password
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleChangePassword} className="space-y-4">
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
              {passwordLoading ? "Updating..." : "Change Password"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
