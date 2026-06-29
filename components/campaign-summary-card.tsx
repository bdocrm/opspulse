'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Search, Users, Target, TrendingUp, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Agent {
  id: string;
  name: string;
  seatNumber: number | null;
  monthlyTarget?: number;
}

export interface Production {
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  volume?: number;
}

export interface CampaignSummaryProps {
  id: string;
  campaignName: string;
  kpiMetric: string;
  goal: number;
  agents: Agent[];
  production: Record<string, Production>;
  attendance: Record<string, { status: string; remarks: string | null }>;
  entriesCount: number;
  onCollectorSearch?: (query: string) => void;
  onDeleteAllAgents?: () => void;
  isDeletingAgents?: boolean;
  children?: React.ReactNode;
}

const ZERO_PROD: Production = { transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0 };

function kpiValueFor(metric: string, prod: Production): number {
  switch (metric) {
    case 'transmittals': return prod.transmittals;
    case 'activations': return prod.activations;
    case 'approvals': return prod.approvals;
    case 'volume': return prod.volume || 0;
    default: return prod.booked;
  }
}

export function CampaignSummaryCard({
  id,
  campaignName,
  kpiMetric,
  goal,
  agents,
  production,
  attendance,
  entriesCount,
  children,
  onCollectorSearch,
  onDeleteAllAgents,
  isDeletingAgents,
}: CampaignSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [collectorsExpanded, setCollectorsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate metrics
  const activeCollectors = agents.filter(a => {
    const record = attendance[a.id];
    return !record || record.status === 'PRESENT';
  }).length;

  const totalProduction = agents.reduce((sum, agent) => {
    const prod = production[agent.id] || ZERO_PROD;
    return sum + kpiValueFor(kpiMetric, prod);
  }, 0);

  const achievement = goal > 0 ? ((totalProduction / goal) * 100).toFixed(1) : '0';
  const remainingGoal = Math.max(0, goal - totalProduction);

  // Performance distribution
  const performanceDistribution = useMemo(() => {
    const distribution = { excellent: 0, good: 0, average: 0, needsImprovement: 0 };
    agents.forEach(agent => {
      const prod = production[agent.id] || ZERO_PROD;
      const value = kpiValueFor(kpiMetric, prod);
      const target = agent.monthlyTarget || 0;
      if (target === 0) return;
      const progress = (value / target) * 100;
      if (progress >= 100) distribution.excellent++;
      else if (progress >= 80) distribution.good++;
      else if (progress >= 50) distribution.average++;
      else distribution.needsImprovement++;
    });
    return distribution;
  }, [agents, production, kpiMetric]);

  // Top and bottom performers
  const performerStats = useMemo(() => {
    const performers = agents
      .map(agent => {
        const prod = production[agent.id] || ZERO_PROD;
        const value = kpiValueFor(kpiMetric, prod);
        const target = agent.monthlyTarget || 0;
        return { agent, value, target, progress: target > 0 ? (value / target) * 100 : 0 };
      })
      .sort((a, b) => b.progress - a.progress);

    return {
      topPerformer: performers[0],
      bottomPerformer: performers[performers.length - 1],
      reachedGoal: performers.filter(p => p.progress >= 100).length,
      belowTarget: performers.filter(p => p.progress < 100 && p.target > 0).length,
      withProduction: performers.filter(p => p.value > 0).length,
      zeroProduction: performers.filter(p => p.value === 0).length,
    };
  }, [agents, production, kpiMetric]);

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(a => a.name.toLowerCase().includes(q) || a.seatNumber?.toString().includes(q));
  }, [agents, searchQuery]);

  return (
    <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow">
      {/* Header - Always Visible */}
      <CardHeader
        className="pb-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <ChevronDown
              className={cn(
                'w-5 h-5 text-muted-foreground transition-transform flex-shrink-0',
                expanded && 'rotate-180'
              )}
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-lg text-foreground truncate">{campaignName}</h3>
              <p className="text-xs text-muted-foreground capitalize mt-1">{kpiMetric}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0 ml-4">
            <p className="text-2xl font-bold text-primary">{achievement}%</p>
            <p className="text-xs text-muted-foreground">{activeCollectors} collectors</p>
          </div>
        </div>
      </CardHeader>

      {/* Expanded Content */}
      {expanded && (
        <CardContent className="pt-0 space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Monthly Goal</p>
              <p className="text-xl font-bold text-blue-600">{goal.toLocaleString()}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Current Prod.</p>
              <p className="text-xl font-bold text-purple-600">{totalProduction.toLocaleString()}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Remaining</p>
              <p className="text-xl font-bold text-orange-600">{remainingGoal.toLocaleString()}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Entries</p>
              <p className="text-xl font-bold text-green-600">{entriesCount}</p>
            </div>
          </div>

          {/* Collector Stats */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Collector Performance</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Excellent (100%+)</p>
                <p className="font-bold text-lg">{performanceDistribution.excellent}</p>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Good (80-99%)</p>
                <p className="font-bold text-lg">{performanceDistribution.good}</p>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Average (50-79%)</p>
                <p className="font-bold text-lg">{performanceDistribution.average}</p>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Needs Work (&lt;50%)</p>
                <p className="font-bold text-lg">{performanceDistribution.needsImprovement}</p>
              </div>
            </div>
          </div>

          {/* Top/Bottom Performers */}
          <div className="grid grid-cols-2 gap-3">
            {performerStats.topPerformer && (
              <div className="bg-green-50/50 border border-green-200/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                  Top Performer
                </p>
                <p className="font-semibold text-sm truncate">{performerStats.topPerformer.agent.name}</p>
                <p className="text-xs text-muted-foreground">{performerStats.topPerformer.progress.toFixed(0)}% of target</p>
              </div>
            )}
            {performerStats.bottomPerformer && performerStats.bottomPerformer.agent.id && (
              <div className="bg-amber-50/50 border border-amber-200/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-600" />
                  Lowest Performer
                </p>
                <p className="font-semibold text-sm truncate">{performerStats.bottomPerformer.agent.name}</p>
                <p className="text-xs text-muted-foreground">{performerStats.bottomPerformer.progress.toFixed(0)}% of target</p>
              </div>
            )}
          </div>

          {/* Collector Expandable Section */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setCollectorsExpanded(!collectorsExpanded)}
                className="flex-1 flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-muted-foreground transition-transform',
                      collectorsExpanded && 'rotate-180'
                    )}
                  />
                  <span className="font-semibold text-sm">View Collector Details ({filteredAgents.length})</span>
                </div>
                <span className="text-xs text-muted-foreground">{agents.length} total</span>
              </button>
              {onDeleteAllAgents && agents.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={onDeleteAllAgents}
                  disabled={isDeletingAgents}
                  title="Delete all agents in this campaign"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {isDeletingAgents ? 'Deleting...' : 'Delete All'}
                </Button>
              )}
            </div>

            {collectorsExpanded && (
              <div className="mt-3 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search collectors..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      onCollectorSearch?.(e.target.value);
                    }}
                    className="pl-8 h-8 text-sm"
                  />
                </div>

                {/* Collector Table via Children */}
                {children}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
