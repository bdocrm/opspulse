"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/layout/page-title";
import { Users, Briefcase, BarChart3 } from "lucide-react";

export default function CollectorCampaignPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Check authorization
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && (session?.user as any)?.role !== "COLLECTOR") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  // Fetch agents for this collector's campaign
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch("/api/collector/agents");
        if (res.ok) {
          const data = await res.json();
          setAgents(data);
        }
      } catch (error) {
        console.error("Error fetching agents:", error);
      } finally {
        setLoading(false);
      }
    };

    if (status === "authenticated") {
      fetchAgents();
    }
  }, [status]);

  const campaignName = (session?.user as any)?.campaignName;
  const collectorName = (session?.user as any)?.name;

  if (status === "loading" || loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <PageTitle title="My Campaign" />

      {/* Campaign Header */}
      <Card className="border-l-4 border-l-blue-500">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{campaignName}</CardTitle>
              <p className="text-sm text-gray-600 mt-2">Collector: {collectorName}</p>
            </div>
            <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded text-sm font-medium">
              Team Lead
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Team Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agents.length}</div>
            <p className="text-xs text-gray-600 mt-1">In your team</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Campaign Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Active</div>
            <p className="text-xs text-gray-600 mt-1">Ready for data entry</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <a href="/collector/data-entry" className="text-blue-600 hover:underline">
                → Add Data Entry
              </a>
              <a href="/collector" className="text-blue-600 hover:underline block">
                → View Dashboard
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle>Your Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-gray-600 py-8 text-center">
              No agents assigned to your campaign yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="p-4 border rounded-lg hover:bg-gray-50 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold">{agent.name}</h4>
                      <p className="text-xs text-gray-600">{agent.email}</p>
                      {agent.seatNumber && (
                        <p className="text-xs font-medium mt-2">
                          Seat: <span className="bg-gray-100 px-2 py-1 rounded">{agent.seatNumber}</span>
                        </p>
                      )}
                    </div>
                    {agent.monthlyTarget && (
                      <div className="text-right">
                        <p className="text-xs text-gray-600">Target</p>
                        <p className="text-lg font-bold">{agent.monthlyTarget}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
