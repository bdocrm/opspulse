-- CreateEnum
CREATE TYPE "AgentLevel" AS ENUM ('CORE', 'ROOKIE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "agentLevel" "AgentLevel";

-- CreateIndex
CREATE INDEX "User_agentLevel_idx" ON "User"("agentLevel");
