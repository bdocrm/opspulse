-- Additive, backward-compatible campaign mapping persistence and import traceability.
CREATE TABLE "CampaignMapping" (
    "id" TEXT NOT NULL,
    "sourceAccount" TEXT NOT NULL,
    "normalizedSourceAccount" TEXT NOT NULL,
    "sourceCampaign" TEXT NOT NULL,
    "normalizedSourceCampaign" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'PRODUCTION_MONITORING',
    "opsviewCampaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mappingType" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CampaignMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignMappingAudit" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldCampaignId" TEXT,
    "newCampaignId" TEXT,
    "importId" TEXT,
    "changedById" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignMappingAudit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductionMonitoring"
ADD COLUMN "sourceAccount" TEXT,
ADD COLUMN "sourceCampaign" TEXT,
ADD COLUMN "campaignMappingId" TEXT,
ADD COLUMN "productionImportId" TEXT,
ADD COLUMN "importedById" TEXT;

CREATE UNIQUE INDEX "CampaignMapping_source_pair_key" ON "CampaignMapping"("sourceSystem", "normalizedSourceAccount", "normalizedSourceCampaign");
CREATE INDEX "CampaignMapping_normalizedSourceAccount_normalizedSourceCampaign_status_idx" ON "CampaignMapping"("normalizedSourceAccount", "normalizedSourceCampaign", "status");
CREATE INDEX "CampaignMapping_opsviewCampaignId_status_idx" ON "CampaignMapping"("opsviewCampaignId", "status");
CREATE INDEX "CampaignMappingAudit_mappingId_createdAt_idx" ON "CampaignMappingAudit"("mappingId", "createdAt");
CREATE INDEX "CampaignMappingAudit_changedById_createdAt_idx" ON "CampaignMappingAudit"("changedById", "createdAt");
CREATE INDEX "CampaignMappingAudit_importId_idx" ON "CampaignMappingAudit"("importId");
CREATE INDEX "ProductionMonitoring_campaignMappingId_idx" ON "ProductionMonitoring"("campaignMappingId");
CREATE INDEX "ProductionMonitoring_productionImportId_idx" ON "ProductionMonitoring"("productionImportId");
CREATE INDEX "ProductionMonitoring_importedById_idx" ON "ProductionMonitoring"("importedById");

ALTER TABLE "CampaignMapping" ADD CONSTRAINT "CampaignMapping_opsviewCampaignId_fkey" FOREIGN KEY ("opsviewCampaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignMapping" ADD CONSTRAINT "CampaignMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignMapping" ADD CONSTRAINT "CampaignMapping_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignMappingAudit" ADD CONSTRAINT "CampaignMappingAudit_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "CampaignMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignMappingAudit" ADD CONSTRAINT "CampaignMappingAudit_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ProductionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignMappingAudit" ADD CONSTRAINT "CampaignMappingAudit_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoring" ADD CONSTRAINT "ProductionMonitoring_campaignMappingId_fkey" FOREIGN KEY ("campaignMappingId") REFERENCES "CampaignMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoring" ADD CONSTRAINT "ProductionMonitoring_productionImportId_fkey" FOREIGN KEY ("productionImportId") REFERENCES "ProductionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoring" ADD CONSTRAINT "ProductionMonitoring_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
