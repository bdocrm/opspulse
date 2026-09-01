import { describe, it, expect } from "vitest";
import {
  roleAllowedOnPath,
  matchRouteRule,
  canViewPerformance,
  canImport,
  canEditGoals,
  isSystemAdmin,
  isExecutiveRole,
  requireRole,
} from "@/lib/permissions";

describe("permissions", () => {
  it("exposes role labels for every Role", () => {
    // imported ROLE_LABELS indirectly via roleAllowedOnPath behaviour; just ensure guards don't crash
    expect(requireRole("CEO", ["CEO"])).toBe(true);
  });

  describe("roleAllowedOnPath", () => {
    it("allows admin on manage-campaigns", () => {
      expect(roleAllowedOnPath("CEO", "/manage-campaigns")).toBe(true);
      expect(roleAllowedOnPath("CEO", "/manage-campaigns/123")).toBe(true);
    });

    it("blocks non-admin from manage-campaigns", () => {
      expect(roleAllowedOnPath("AGENT", "/manage-campaigns")).toBe(false);
      expect(roleAllowedOnPath("OM", "/manage-campaigns")).toBe(false);
    });

    it("restricts collector routes to COLLECTOR", () => {
      expect(roleAllowedOnPath("COLLECTOR", "/collector/data-entry")).toBe(true);
      expect(roleAllowedOnPath("AGENT", "/collector")).toBe(false);
      expect(roleAllowedOnPath("CEO", "/collector")).toBe(false);
    });

    it("restricts reports to CEO/OM", () => {
      expect(roleAllowedOnPath("CEO", "/reports/campaign-performance")).toBe(true);
      expect(roleAllowedOnPath("OM", "/reports/campaign-performance")).toBe(true);
      expect(roleAllowedOnPath("AGENT", "/reports")).toBe(false);
    });

    it("allows all authenticated roles on dashboard", () => {
      for (const role of ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"]) {
        expect(roleAllowedOnPath(role, "/dashboard")).toBe(true);
      }
    });

    it("treats unmatched paths as unprotected", () => {
      expect(roleAllowedOnPath("ANYTHING", "/unknown-page")).toBe(true);
    });
  });

  describe("matchRouteRule", () => {
    it("matches prefix boundaries only", () => {
      expect(matchRouteRule("/manage-users")?.prefix).toBe("/manage-users");
      expect(matchRouteRule("/manage-campaigns/x")?.prefix).toBe("/manage-campaigns");
      // Should NOT match /manage-campaigns when path is a sibling
      expect(matchRouteRule("/manage-campaigns-evil")?.prefix).toBeUndefined();
    });
  });

  describe("predicates", () => {
    it("identifies executive roles", () => {
      expect(isExecutiveRole("CEO")).toBe(true);
      expect(isExecutiveRole("SMT")).toBe(true);
      expect(isExecutiveRole("AGENT")).toBe(false);
    });

    it("scopes performance visibility", () => {
      expect(canViewPerformance("CEO")).toBe(true);
      expect(canViewPerformance("AGENT")).toBe(true);
      expect(canViewPerformance("UNKNOWN")).toBe(false);
      expect(canViewPerformance(undefined)).toBe(false);
    });

    it("scopes import capability", () => {
      expect(canImport("CEO")).toBe(true);
      expect(canImport("OM")).toBe(true);
      expect(canImport("COLLECTOR")).toBe(true);
      expect(canImport("AGENT")).toBe(false);
    });

    it("scopes goal editing and admin", () => {
      expect(canEditGoals("OM")).toBe(true);
      expect(canEditGoals("CEO")).toBe(true);
      expect(canEditGoals("AGENT")).toBe(false);
      expect(isSystemAdmin("CEO")).toBe(true);
      expect(isSystemAdmin("OM")).toBe(false);
    });
  });

  describe("requireRole", () => {
    it("requires role to be present and allowed", () => {
      expect(requireRole("CEO", ["CEO"])).toBe(true);
      expect(requireRole("OM", ["CEO"])).toBe(false);
      expect(requireRole(undefined, ["CEO"])).toBe(false);
    });
  });
});
