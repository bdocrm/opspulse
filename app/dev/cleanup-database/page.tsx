"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageTitle } from "@/components/layout/page-title";
import { useToast } from "@/components/toast-provider";
import { AlertTriangle } from "lucide-react";

export default function CleanupDatabasePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { addToast } = useToast();

  const [confirmed, setConfirmed] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Check authorization
  if (status === "loading") {
    return <div className="p-6">Loading...</div>;
  }

  if (!session?.user || (session.user as any).role !== "CEO") {
    return (
      <div className="p-6">
        <div className="border border-red-200 bg-red-50 p-4 rounded-lg flex gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-red-800">
            Access denied. Only CEO can access this page.
          </div>
        </div>
      </div>
    );
  }

  const handleCleanup = async () => {
    if (!confirmed || !confirmed2) {
      addToast("error", "Please confirm both checkboxes");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/dev/cleanup-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCode: "CLEANUP_CONFIRMED_2026" }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Cleanup failed");
      }

      const data = await res.json();
      setResult(data);
      addToast("success", "✅ Database cleaned successfully!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed";
      addToast("error", message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title="Database Cleanup"
        subtitle="Remove all data except campaigns and CEO accounts"
      />

      <div className="border border-orange-200 bg-orange-50 p-4 rounded-lg flex gap-3">
        <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
        <div className="text-orange-800">
          <strong>Warning:</strong> This action will delete all users (except CEO), all sales data, attendance
          records, and production entries. Campaigns will be retained. This is irreversible!
        </div>
      </div>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Cleanup Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-red-50 p-4 rounded-lg space-y-4">
            <div className="space-y-3">
              <h3 className="font-semibold">This action will delete:</h3>
              <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
                <li>All non-CEO user accounts (COLLECTOR, OM, AGENT)</li>
                <li>All daily sales records</li>
                <li>All production entries and details</li>
                <li>All attendance records</li>
                <li>All agent targets and history</li>
              </ul>
            </div>

            <div className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">This action will retain:</h3>
              <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
                <li>All campaigns (for reassignment)</li>
                <li>All CEO accounts</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="confirm1"
                checked={confirmed}
                onCheckedChange={(val) => setConfirmed(val as boolean)}
              />
              <label
                htmlFor="confirm1"
                className="text-sm font-medium leading-relaxed cursor-pointer"
              >
                I understand this will delete all non-CEO users and their data
              </label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="confirm2"
                checked={confirmed2}
                onCheckedChange={(val) => setConfirmed2(val as boolean)}
              />
              <label
                htmlFor="confirm2"
                className="text-sm font-medium leading-relaxed cursor-pointer"
              >
                I confirm this action and will create new accounts after cleanup
              </label>
            </div>
          </div>

          <Button
            onClick={handleCleanup}
            disabled={loading || !confirmed || !confirmed2}
            className="w-full bg-red-600 hover:bg-red-700"
          >
            {loading ? "Cleaning..." : "🗑️ Proceed with Cleanup"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-600">✅ Cleanup Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-white rounded border">
                <p className="text-sm text-gray-600">Deleted Users</p>
                <p className="text-2xl font-bold text-red-600">{result.data.deletedUsers}</p>
              </div>
              <div className="p-3 bg-white rounded border">
                <p className="text-sm text-gray-600">Deleted Sales Records</p>
                <p className="text-2xl font-bold text-red-600">{result.data.deletedDailySalesRecords}</p>
              </div>
              <div className="p-3 bg-white rounded border">
                <p className="text-sm text-gray-600">Deleted Attendance</p>
                <p className="text-2xl font-bold text-red-600">{result.data.deletedAttendanceRecords}</p>
              </div>
              <div className="p-3 bg-white rounded border">
                <p className="text-sm text-gray-600">Deleted Production Data</p>
                <p className="text-2xl font-bold text-red-600">
                  {result.data.deletedProductionDetails + result.data.deletedProductionEntries}
                </p>
              </div>
              <div className="p-3 bg-white rounded border">
                <p className="text-sm text-gray-600">Retained CEO Accounts</p>
                <p className="text-2xl font-bold text-green-600">{result.data.retainedCeos}</p>
              </div>
              <div className="p-3 bg-white rounded border">
                <p className="text-sm text-gray-600">Retained Campaigns</p>
                <p className="text-2xl font-bold text-green-600">{result.data.retainedCampaigns}</p>
              </div>
            </div>

            {result.data.userDetail && result.data.userDetail.length > 0 && (
              <div className="mt-4 p-3 bg-white rounded border">
                <p className="text-sm font-semibold mb-2">🗑️ Deleted Users:</p>
                <div className="space-y-1">
                  {result.data.userDetail.map(
                    (user: { id: string; name: string; email: string; role: string }) => (
                      <p key={user.id} className="text-xs text-gray-600">
                        {user.name} ({user.role}) - {user.email}
                      </p>
                    )
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
