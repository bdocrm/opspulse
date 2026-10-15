import { describe, expect, it } from "vitest";
import { databaseQuotaError } from "./database-availability";

describe("database availability", () => {
  it("recognizes provider suspension inside a Prisma error without exposing query details", () => {
    const error = new Error('Invalid prisma.productionImport.findMany(): private query details\nERROR: Your account or project has exceeded the quota. Upgrade your plan to increase limits.');
    expect(databaseQuotaError(error)).toMatchObject({ code: "DATABASE_QUOTA_EXCEEDED" });
    expect(JSON.stringify(databaseQuotaError(error))).not.toContain("private query details");
  });
  it("recognizes a compute quota suspension", () => {
    expect(databaseQuotaError(new Error("Your account or project has exceeded the compute time quota."))).not.toBeNull();
  });
  it("does not misidentify an unrelated import validation or database error as a quota suspension", () => {
    expect(databaseQuotaError(new Error("Missing September column"))).toBeNull();
    expect(databaseQuotaError(new Error("Database connection timed out"))).toBeNull();
  });
});
