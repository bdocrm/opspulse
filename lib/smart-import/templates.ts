import { prisma } from "../prisma";
import type { ProductionSessionUser } from "../production-access";
import { mappingSignature as signature } from "./automatic-mappings";
import { accessibleBatch, ImportError, json, reviewBatch } from "./service";
import type { Inspection, ReviewOptions } from "./types";

export async function saveTemplate(batchId: string, name: unknown, user: ProductionSessionUser) {
  if (typeof name !== "string" || !name.trim() || name.length > 100) throw new ImportError("Choose a template name up to 100 characters.");
  const batch = await accessibleBatch(batchId, user);
  if (batch.status !== "READY") throw new ImportError("Revalidate mappings before saving a template.", 409);
  const options = batch.reviewOptions as unknown as ReviewOptions;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`TEMPLATE:${user.id}:${name.trim()}`}, 0))::text`;
    const previous = await tx.importMappingTemplate.findFirst({ where: { ownerId: user.id!, name: name.trim() }, orderBy: { version: "desc" } });
    return tx.importMappingTemplate.create({ data: { ownerId: user.id!, name: name.trim(), version: (previous?.version ?? 0) + 1, signature: signature(batch.inspection as unknown as Inspection), options: json({ ...options, fallbackMonth: null, fallbackYear: null, conflictSelections: {}, configs: {} }) } });
  });
}
export async function applyTemplate(batchId: string, templateId: unknown, user: ProductionSessionUser) {
  if (typeof templateId !== "string") throw new ImportError("Choose a saved template.");
  const [batch, template] = await Promise.all([accessibleBatch(batchId, user), prisma.importMappingTemplate.findFirst({ where: { id: templateId, ownerId: user.id! } })]);
  if (!template) throw new ImportError("Mapping template not found.", 404);
  if (template.signature !== signature(batch.inspection as unknown as Inspection)) throw new ImportError("Template layout differs from this workbook. Review its columns manually.", 409);
  const current = batch.reviewOptions as unknown as ReviewOptions;
  await reviewBatch(batchId, { ...(template.options as unknown as ReviewOptions), fallbackMonth: current.fallbackMonth, fallbackYear: current.fallbackYear }, user);
}
