"use client";

import { useEffect, useState } from "react";
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
  Projector,
  UserCircle,
  ChevronDown,
  Factory,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";

interface SidebarLink {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
}

const defaultLinks: SidebarLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ['CEO', 'OM'] },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, roles: ['CEO', 'OM'] },
  { href: "/campaigns/goals", label: "Goals Management", icon: Sliders, roles: ['CEO', 'OM'] },
  { href: "/agent-summaries", label: "Agent Summaries", icon: Users, roles: ['CEO'] },
  { href: "/analytics/trends", label: "Performance Trends", icon: TrendingUp, roles: ['CEO', 'OM'] },
  { href: "/analytics/productivity", label: "Productivity Analytics", icon: Activity, roles: ['CEO', 'OM'] },
  { href: "/reports/campaigns", label: "Campaign Reports", icon: BarChart3, roles: ['CEO', 'OM'] },
  { href: "/reports/campaign-performance", label: "Agent Performance", icon: Zap, roles: ['CEO', 'OM'] },
  { href: "/performance/kpi", label: "KPI Monitoring", icon: Gauge, roles: ['CEO', 'SMT', 'OM', 'AGENT'] },
  { href: "/production-monitoring", label: "Production Monitoring", icon: Factory, roles: ['CEO', 'SMT', 'OM', 'COLLECTOR', 'AGENT'] },
  { href: "/om-dashboard", label: "OM Dashboard", icon: Gauge, roles: ['OM'] },
  { href: "/presentation", label: "OpsView Deck", icon: Projector, roles: ['CEO', 'OM'] },
  { href: "/my-account", label: "My Account", icon: UserCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

const adminLinks: SidebarLink[] = [
  { href: "/manage-campaigns", label: "Manage Campaigns", icon: Sliders },
  { href: "/production-monitoring/admin/campaign-mappings", label: "Campaign Mapping", icon: Waypoints },
  { href: "/manage-users", label: "Manage Users", icon: Users },
];

const collectorLinks: SidebarLink[] = [
  { href: "/collector/campaign", label: "My Campaign", icon: Megaphone },
  { href: "/collector", label: "Collector Dashboard", icon: BarChart3 },
  { href: "/collector/data-entry", label: "Data Entry", icon: ClipboardList },
  { href: "/collector/bulk-import", label: "Bulk Import", icon: Zap },
  { href: "/performance/kpi", label: "KPI Monitoring", icon: Gauge },
  { href: "/production-monitoring", label: "Production Monitoring", icon: Factory },
];

const groupedLinkSections = [
  {
    label: "Performance",
    links: [
      "/agent-summaries",
      "/analytics/trends",
      "/analytics/productivity",
      "/reports/campaigns",
      "/reports/campaign-performance",
      "/om-dashboard",
      "/performance/kpi",
      "/production-monitoring",
    ],
  },
  {
    label: "Management",
    links: ["/campaigns", "/campaigns/goals", "/manage-campaigns", "/manage-users", "/production-monitoring/admin/campaign-mappings"],
  },
  {
    label: "Reports",
    links: ["/presentation"],
  },
  {
    label: "Account",
    links: ["/my-account", "/settings"],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const activeSection = groupedLinkSections.find((section) =>
      section.links.some((href) => pathname.startsWith(href))
    );
    return new Set(activeSection ? [activeSection.label] : []);
  });
  const userRole = (session?.user as any)?.role;
  const allLinks = [...defaultLinks, ...(userRole === 'CEO' ? adminLinks : [])];
  const visibleLinks = allLinks.filter(({ href, roles }) => {
    if (roles && !roles.includes(userRole)) {
      return false;
    }
    if (userRole === 'COLLECTOR') {
      return href !== '/dashboard' && href !== '/campaigns';
    }
    return true;
  });

  useEffect(() => {
    const activeSection = groupedLinkSections.find((section) =>
      section.links.some((href) => pathname.startsWith(href))
    );
    if (!activeSection) return;
    setExpandedSections((current) => {
      if (current.has(activeSection.label)) return current;
      return new Set([...current, activeSection.label]);
    });
  }, [pathname]);

  const toggleSection = (label: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const renderLink = ({ href, label, icon: Icon }: SidebarLink) => {
    const active = pathname === href || (href !== "/collector" && pathname.startsWith(`${href}/`));
    return (
      <Link
        key={href}
        href={href}
        onClick={onClose}
        className={cn(
          "group relative flex items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-sm font-medium transition-[color,background-color,transform] duration-200 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
        aria-current={active ? "page" : undefined}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-0 w-0.5 origin-center rounded-r-full bg-primary transition-transform duration-200 ease-out",
            active ? "scale-y-100" : "scale-y-0"
          )}
        />
        <Icon className="h-5 w-5 transition-colors duration-200" />
        <span className="transition-colors duration-200">{label}</span>
      </Link>
    );
  };

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
              alt="OpsView 360"
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
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {/* Collector Links - Show first for collectors */}
          {userRole === 'COLLECTOR' ? (
            <div className="space-y-1">
              {collectorLinks.map(renderLink)}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {visibleLinks.filter((link) => link.href === "/dashboard").map(renderLink)}
              </div>
              {groupedLinkSections.map((section) => {
                const links = visibleLinks.filter((link) => section.links.includes(link.href));
                if (links.length === 0) return null;
                const expanded = expandedSections.has(section.label);
                return (
                  <div key={section.label} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleSection(section.label)}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span>{section.label}</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform duration-200",
                          expanded && "rotate-180"
                        )}
                      />
                    </button>
                    {expanded && (
                      <div className="space-y-1">
                        {links.map(renderLink)}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
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
