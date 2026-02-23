-- CreateTable
CREATE TABLE "node_system_info" (
    "nodeId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reported_ts" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_system_info_pkey" PRIMARY KEY ("nodeId")
);

-- CreateIndex
CREATE INDEX "node_system_info_hash_idx" ON "node_system_info"("hash");

-- AddForeignKey
ALTER TABLE "node_system_info" ADD CONSTRAINT "node_system_info_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
