"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Megaphone,
  Users,
  Settings,
  X,
  Sliders,
  BarChart3,
  ClipboardList,
  TrendingUp,
  Activity,
  Zap,
  Gauge,
} from "lucide-react";
import { useSession } from "next-auth/react";

const defaultLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ['CEO', 'OM'] },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, roles: ['CEO', 'OM'] },
  { href: "/campaigns/goals", label: "Goals Management", icon: Sliders, roles: ['CEO', 'OM'] },
  { href: "/agent-summaries", label: "Agent Summaries", icon: Users, roles: ['CEO'] },
  { href: "/analytics/trends", label: "Performance Trends", icon: TrendingUp, roles: ['CEO', 'OM'] },
  { href: "/analytics/productivity", label: "Productivity Analytics", icon: Activity, roles: ['CEO', 'OM'] },
  { href: "/reports/campaigns", label: "Campaign Reports", icon: BarChart3, roles: ['CEO', 'OM'] },
  { href: "/reports/campaign-performance", label: "Agent Performance", icon: Zap, roles: ['CEO', 'OM'] },
  { href: "/om-dashboard", label: "OM Dashboard", icon: Gauge, roles: ['OM'] },
  { href: "/settings", label: "Settings", icon: Settings },
];

const adminLinks = [
  { href: "/manage-campaigns", label: "Manage Campaigns", icon: Sliders },
  { href: "/manage-users", label: "Manage Users", icon: Users },
];

const collectorLinks = [
  { href: "/collector/campaign", label: "My Campaign", icon: Megaphone },
  { href: "/collector", label: "Collector Dashboard", icon: BarChart3 },
  { href: "/collector/data-entry", label: "Data Entry", icon: ClipboardList },
  { href: "/collector/bulk-import", label: "Bulk Import", icon: Zap },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;

  return (
    <>
      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r bg-card transition-transform duration-300 lg:translate-x-0 lg:z-30",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex flex-col items-center justify-center border-b px-4 py-4">
          <Link href={userRole === 'COLLECTOR' ? '/collector' : '/dashboard'} className="flex flex-col items-center">
            <Image
              src="/ops.png"
              alt="OpsPulse 360"
              width={200}
              height={200}
              className="h-[200px] w-[200px] object-contain"
              priority
              unoptimized
            />
          </Link>
          <button className="lg:hidden absolute top-4 right-4" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {/* Collector Links - Show first for collectors */}
          {userRole === 'COLLECTOR' && collectorLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}

          {/* Default Links - Filter by role */}
          {defaultLinks
            .filter(({ href, roles }) => {
              if (roles && !roles.includes(userRole)) {
                return false;
              }
              if (userRole === 'COLLECTOR') {
                // Hide Dashboard and Campaigns from COLLECTOR view
                return href !== '/dashboard' && href !== '/campaigns';
              }
              return true;
            })
            .map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              );
            })}

          {/* Admin Links - Only for CEO */}
          {userRole === 'CEO' && adminLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground text-center">
            Developed by Business Dev Team
          </p>
        </div>
      </aside>
    </>
  );
}
