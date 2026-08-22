"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Briefcase, Users } from "lucide-react";
import { PageTitle } from "@/components/layout/page-title";
import {
  CountUp,
  motionDelay,
  ViewportRevealGroup,
} from "@/components/motion/dashboard-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface CampaignAgent {
  id: string;
  name: string;
  email: string;
  seatNumber?: string | null;
  monthlyTarget?: number | null;
}

function CampaignPageSkeleton() {
  return (
    <div className="space-y-6 p-2 sm:p-4 lg:p-8" aria-label="Loading campaign" aria-busy="true">
      <Skeleton className="campaign-skeleton h-8 w-48" />
      <Skeleton className="campaign-skeleton h-32 w-full" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="campaign-skeleton h-36 w-full" />
        ))}
      </div>
      <div className="rounded-lg border p-6">
        <Skeleton className="campaign-skeleton h-6 w-44" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="campaign-skeleton h-24 w-full" />
          ))}
        </div>
      </div>
      <span className="sr-only">Campaign information and team members are loading.</span>
    </div>
  );
}

export default function CollectorCampaignPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [agents, setAgents] = useState<CampaignAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && (session?.user as { role?: string })?.role !== "COLLECTOR") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await fetch("/api/collector/agents");
        if (response.ok) {
          const data: CampaignAgent[] = await response.json();
          setAgents(data);
        }
      } catch (error) {
        console.error("Error fetching agents:", error);
      } finally {
        setLoading(false);
      }
    };

    if (status === "authenticated") fetchAgents();
  }, [status]);

  const campaignName = (session?.user as { campaignName?: string } | undefined)?.campaignName;
  const collectorName = (session?.user as { name?: string } | undefined)?.name;

  if (status === "loading" || loading) return <CampaignPageSkeleton />;

  return (
    <div className="space-y-6 p-2 sm:p-4 lg:p-8">
      <PageTitle title="My Campaign" className="campaign-enter mb-0" />

      <Card className="campaign-card-enter relative overflow-hidden border-l-0">
        <span className="campaign-accent-line absolute inset-y-0 left-0 w-1 bg-blue-500" aria-hidden="true" />
        <CardHeader>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <CardTitle className="truncate text-2xl">{campaignName || "Assigned Campaign"}</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">Collector: {collectorName}</p>
            </div>
            <div className="shrink-0 rounded bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
              Team Lead
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="campaign-summary-enter" style={motionDelay(180)}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              Total Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold"><CountUp value={agents.length} /></div>
            <p className="mt-1 text-xs text-muted-foreground">In your team</p>
          </CardContent>
        </Card>

        <Card className="campaign-summary-enter" style={motionDelay(250)}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Briefcase className="h-4 w-4" />
              Campaign Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="campaign-status-enter flex items-center gap-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              <span className="campaign-status-dot h-2.5 w-2.5 rounded-full bg-current" aria-hidden="true" />
              Active
            </div>
            <p className="campaign-status-detail mt-1 text-xs text-muted-foreground">Ready for data entry</p>
          </CardContent>
        </Card>

        <Card className="campaign-summary-enter" style={motionDelay(320)}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <BarChart3 className="h-4 w-4" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <Link href="/collector/data-entry" className="campaign-action group">
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true" />
                <span>Add Data Entry</span>
              </Link>
              <Link href="/collector" className="campaign-action group">
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true" />
                <span>View Dashboard</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="campaign-team-enter">
        <CardHeader><CardTitle>Your Team Members</CardTitle></CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No agents assigned to your campaign yet.</p>
          ) : (
            <ViewportRevealGroup initialDelay={440} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <div key={agent.id} data-reveal-item className="campaign-team-member rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="campaign-member-name truncate font-semibold">{agent.name}</h4>
                      <p className="truncate text-xs text-muted-foreground">{agent.email}</p>
                      {agent.seatNumber && (
                        <p className="mt-2 text-xs font-medium">
                          Seat: <span className="rounded bg-muted px-2 py-1">{agent.seatNumber}</span>
                        </p>
                      )}
                    </div>
                    {agent.monthlyTarget != null && (
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-muted-foreground">Target</p>
                        <p className="text-lg font-bold tabular-nums">{agent.monthlyTarget}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </ViewportRevealGroup>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
