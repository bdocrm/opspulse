// Central permission map for OpsView. This is the single source of truth for
// role-based access across the middleware, API route guards, and UI helpers.
// The enum values match the Prisma `Role` enum (and the JWT/session role).

export const Roles = ["CEO", "SMT", "COLLECTOR", "OM", "AGENT"] as const;
export type Role = (typeof Roles)[number];

export type Permission = string;

export const ROLE_LABELS: Record<Role, string> = {
  CEO: "CEO",
  SMT: "Senior Management Team",
  COLLECTOR: "Collector",
  OM: "Operations Manager",
  AGENT: "Agent",
};

// ---- Named capability predicates -----------------------------------------

// Full visibility across every campaign (used to bypass campaign scoping).
export function isExecutiveRole(role?: string | null): boolean {
  return role === "CEO" || role === "SMT";
}

// Anyone who operates the system and has a user-facing role.
export function canViewPerformance(role?: string | null): boolean {
  return ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"].includes(role ?? "");
}

// Who is allowed to import KPI / production workbooks.
export function canImport(role?: string | null): boolean {
  return ["CEO", "OM", "COLLECTOR"].includes(role ?? "");
}

// Who can edit the sales/production targets.
export function canEditGoals(role?: string | null): boolean {
  return role === "CEO" || role === "OM";
}

// Who can manage users / campaigns (system administration).
export function isSystemAdmin(role?: string | null): boolean {
  return role === "CEO";
}

// Who can submit collector data entries.
export function isCollector(role?: string | null): boolean {
  return role === "COLLECTOR";
}

// Who can view OpsView reports.
export function canViewReports(role?: string | null): boolean {
  return role === "CEO" || role === "OM";
}

// ---- Aggregate access map (web paths -> permitted roles) ------------------

// Canonical list of protected web paths and the roles that may access them.
// Route groups here must stay in sync with `middleware.ts` so that the shared
// configuration is the only thing that needs to change when access rules change.
export interface RouteRule {
  prefix: string;
  roles: Role[];
}

export const WEB_ROUTE_RULES: RouteRule[] = [
  { prefix: "/dashboard", roles: ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"] },
  { prefix: "/campaigns", roles: ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"] },
  { prefix: "/agents", roles: ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"] },
  { prefix: "/collector", roles: ["COLLECTOR"] },
  { prefix: "/performance", roles: ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"] },
  { prefix: "/production-monitoring", roles: ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"] },
  { prefix: "/manage-campaigns", roles: ["CEO"] },
  { prefix: "/manage-users", roles: ["CEO"] },
  { prefix: "/manage-agents", roles: ["CEO", "OM", "COLLECTOR"] },
  { prefix: "/settings", roles: ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"] },
  { prefix: "/reports", roles: ["CEO", "OM"] },
];

/** Returns the first routing rule matching the given path, if any. */
export function matchRouteRule(pathname: string): RouteRule | undefined {
  return WEB_ROUTE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
}

/** True if the role is allowed on a given web path (no match = not protected). */
export function roleAllowedOnPath(role: string | undefined, pathname: string): boolean {
  const rule = matchRouteRule(pathname);
  if (!rule) return true;
  return rule.roles.includes(role as Role);
}

// ---- API route guards -----------------------------------------------------

export function requireRole(role: string | undefined, allowed: Role[]): boolean {
  return role !== undefined && (allowed as string[]).includes(role);
}

export const API_GUARDS = {
  users: ["CEO"],
  "manage-campaigns": ["CEO"],
  "collectors": ["COLLECTOR"],
  "goals": ["CEO", "OM"],
  "reports": ["CEO", "OM"],
} as const;
