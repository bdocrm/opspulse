-- Create ProductionEntry table
CREATE TABLE IF NOT EXISTS "ProductionEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionEntry_pkey" PRIMARY KEY ("id")
);

-- Create ProductionDetail table
CREATE TABLE IF NOT EXISTS "ProductionDetail" (
    "id" TEXT NOT NULL,
    "productionEntryId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "transmittals" INTEGER NOT NULL DEFAULT 0,
    "activations" INTEGER NOT NULL DEFAULT 0,
    "approvals" INTEGER NOT NULL DEFAULT 0,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "qualityRate" DOUBLE PRECISION,
    "conversionRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDetail_pkey" PRIMARY KEY ("id")
);

-- Create indexes for ProductionEntry
CREATE INDEX IF NOT EXISTS "ProductionEntry_campaignId_idx" ON "ProductionEntry"("campaignId");
CREATE INDEX IF NOT EXISTS "ProductionEntry_date_idx" ON "ProductionEntry"("date");

-- Create indexes for ProductionDetail
CREATE INDEX IF NOT EXISTS "ProductionDetail_productionEntryId_idx" ON "ProductionDetail"("productionEntryId");
CREATE INDEX IF NOT EXISTS "ProductionDetail_agentId_idx" ON "ProductionDetail"("agentId");

-- Add foreign key constraint
ALTER TABLE "ProductionDetail" 
ADD CONSTRAINT "ProductionDetail_productionEntryId_fkey" 
FOREIGN KEY ("productionEntryId") 
REFERENCES "ProductionEntry"("id") 
ON DELETE CASCADE ON UPDATE CASCADE;
