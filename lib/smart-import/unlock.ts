import { randomUUID } from "crypto";
import { prisma, databaseTable } from "../prisma";
import type { ProductionSessionUser } from "../production-access";
import { accessibleBatch, extractBatch, getPreview, ImportError, json } from "./service";
import { DecryptionError, decryptWorkbook } from "./decryption";
import { inspectEncryption } from "./encryption";
import type { Inspection } from "./types";

const table = databaseTable("ProductionImport");
const WINDOW = 10 * 60 * 1000;
const MESSAGES: Record<string, string> = {
  INVALID_PASSWORD: "That password did not unlock the workbook. Check it with the workbook owner and try again.",
  UNSUPPORTED_ENCRYPTION: "This encryption profile is unsupported. Ask the owner for a supported encrypted XLSX workbook.",
  CORRUPTED_WORKBOOK: "The encrypted workbook failed integrity checks. Ask the owner for a fresh copy.",
  PROCESSING_TIMEOUT: "Workbook processing timed out. You can retry after the current request has ended.",
  REQUEST_INTERRUPTED: "Workbook processing was interrupted. Enter the password again to retry.",
  PROCESSING_FAILED: "Workbook processing is temporarily unavailable. Retry shortly; the encrypted original is retained.",
  EXTRACTION_FAILED: "The workbook unlocked, but extraction failed. Check its integrity and supported size/layout limits before retrying.",
};
export class UnlockError extends ImportError {
  constructor(public code: string, status = 422, public batchId?: string, public retryAfter?: number) { super(MESSAGES[code] ?? "The workbook could not be processed.", status); }
}
export async function unlockBatch(id: string, password: unknown, user: ProductionSessionUser, signal?: AbortSignal) {
  const initial = await accessibleBatch(id, user);
  if (initial.importedById !== user.id) throw new ImportError("Only the uploader can unlock this workbook.", 403);
  if (typeof password !== "string" || !password.trim() || password.length > 255) throw new ImportError("Enter a password between 1 and 255 characters.", 400);
  let secret: string | undefined = password;
  password = undefined;
  const lease = randomUUID();
  let decrypted: Buffer | undefined;
  const batch = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`UNLOCK_USER:${user.id}`}, 0))::text`;
    await tx.$queryRaw`SELECT "id" FROM ${table} WHERE "id" = ${id} FOR UPDATE`;
    const current = await accessibleBatch(id, user, tx);
    if (current.importedById !== user.id) throw new ImportError("Only the uploader can unlock this workbook.", 403);
    const inspection = current.inspection as unknown as Inspection;
    if (["STAGED", "READY", "COMPLETED", "COMPLETED_WITH_WARNINGS", "PARTIALLY_IMPORTED"].includes(current.status) && inspection.metadata?.accessStatus === "DECRYPTED") return null;
    if (current.status === "DECRYPTING" && Date.now() - Number(inspection.metadata?.unlockStartedAt ?? 0) < 330000) throw new ImportError("This workbook is already unlocking. Wait for the current request to finish.", 409);
    if (!["PASSWORD_REQUIRED", "INVALID_PASSWORD", "UNSUPPORTED_ENCRYPTION", "EXTRACTION_FAILED", "DECRYPTING"].includes(current.status)) throw new ImportError("This workbook cannot be unlocked in its current state.", 409);
    if (!current.originalFile) throw new ImportError("The encrypted source is unavailable.", 404);
    const profile = inspectEncryption(Buffer.from(current.originalFile));
    if (!profile.supported) throw new UnlockError("UNSUPPORTED_ENCRYPTION", 422, id);
    const since = new Date(Date.now() - WINDOW);
    const [fileAttempts, userAttempts] = await Promise.all([
      tx.productionImportIssue.count({ where: { importId: id, code: "UNLOCK_ATTEMPT", createdAt: { gte: since } } }),
      tx.productionImportIssue.count({ where: { code: "UNLOCK_ATTEMPT", rawData: { path: ["actorId"], equals: user.id! }, createdAt: { gte: since } } }),
    ]);
    if (fileAttempts >= 5 || userAttempts >= 15) throw new UnlockError("RATE_LIMITED", 429, id, 600);
    await tx.productionImportIssue.create({ data: { importId: id, level: "INFORMATIONAL", code: "UNLOCK_ATTEMPT", message: "An authorized workbook unlock was requested.", rawData: json({ actorId: user.id }) } });
    return tx.productionImport.update({ where: { id }, data: { status: "DECRYPTING", lastError: null, inspection: json({ ...inspection, metadata: { ...inspection.metadata, accessStatus: "DECRYPTING", extractionStatus: "PENDING", unlockLease: lease, unlockStartedAt: Date.now() } }) } });
  });
  if (!batch) { secret = undefined; return getPreview(id, user); }
  try {
    decrypted = await decryptWorkbook(Buffer.from(batch.originalFile!), secret!, signal);
    secret = undefined;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM ${table} WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.productionImport.findUniqueOrThrow({ where: { id } });
      const inspection = current.inspection as unknown as Inspection;
      if (current.status !== "DECRYPTING" || inspection.metadata?.unlockLease !== lease) throw new DecryptionError("REQUEST_INTERRUPTED");
      await tx.productionImport.update({ where: { id }, data: { inspection: json({ ...inspection, metadata: { ...inspection.metadata, accessStatus: "DECRYPTED", extractionStatus: "EXTRACTING" } }) } });
    });
    await prisma.productionImportIssue.createMany({ data: [
      { importId: id, level: "INFORMATIONAL", code: "DECRYPTED", message: "The encrypted source unlocked successfully; the original archive is retained.", rawData: json({ actorId: user.id }) },
      { importId: id, level: "INFORMATIONAL", code: "EXTRACTING", message: "Complete workbook extraction started." },
    ] });
    if (signal?.aborted) throw new DecryptionError("REQUEST_INTERRUPTED");
    const reconciliation = await extractBatch(id, decrypted, user, lease);
    await prisma.productionImportIssue.create({ data: { importId: id, level: "INFORMATIONAL", code: "EXTRACTION_COMPLETED", message: "Stored source reconciliation passed. Business import still requires review and confirmation." } });
    return getPreview(id, user, reconciliation);
  } catch (error) {
    const code = error instanceof DecryptionError ? error.code : "EXTRACTION_FAILED";
    const status = code === "INVALID_PASSWORD" ? "INVALID_PASSWORD" : code === "UNSUPPORTED_ENCRYPTION" ? "UNSUPPORTED_ENCRYPTION" : ["REQUEST_INTERRUPTED", "PROCESSING_TIMEOUT", "PROCESSING_FAILED"].includes(code) ? "PASSWORD_REQUIRED" : "EXTRACTION_FAILED";
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM ${table} WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.productionImport.findUniqueOrThrow({ where: { id } });
      const inspection = current.inspection as unknown as Inspection;
      if (current.status === "DECRYPTING" && inspection.metadata?.unlockLease === lease) {
        await tx.productionImport.update({ where: { id }, data: { status, lastError: MESSAGES[code], inspection: json({ ...inspection, metadata: { ...inspection.metadata, accessStatus: code, extractionStatus: code === "EXTRACTION_FAILED" ? "EXTRACTION_FAILED" : "PENDING", unlockLease: null } }) } });
      }
      await tx.productionImportIssue.create({ data: { importId: id, level: "WARNING", code, message: MESSAGES[code], rawData: json({ actorId: user.id }) } });
    }, { timeout: 30000, maxWait: 10000 });
    throw new UnlockError(code, code === "PROCESSING_TIMEOUT" ? 504 : code === "PROCESSING_FAILED" ? 503 : 422, id);
  } finally { secret = undefined; decrypted?.fill(0); }
}
