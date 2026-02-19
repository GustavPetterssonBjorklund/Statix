-- AlterTable
ALTER TABLE "Node"
ADD COLUMN "mqttUsername" TEXT,
ADD COLUMN "mqttPasswordHash" TEXT,
ADD COLUMN "mqttPasswordExpiresAt" TIMESTAMP(3);
