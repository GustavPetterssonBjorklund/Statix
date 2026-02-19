/*
  Warnings:

  - Added the required column `nodeId` to the `metrics` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "metrics" ADD COLUMN     "nodeId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metrics_nodeId_ts_idx" ON "metrics"("nodeId", "ts");

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
