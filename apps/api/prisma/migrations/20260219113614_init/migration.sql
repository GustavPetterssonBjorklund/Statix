-- CreateTable
CREATE TABLE "metrics" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ts" BIGINT NOT NULL,
    "cpu" DOUBLE PRECISION NOT NULL,
    "mem_used" BIGINT NOT NULL,
    "mem_total" BIGINT NOT NULL,
    "disk_used" BIGINT NOT NULL,
    "disk_total" BIGINT NOT NULL,
    "net_rx" BIGINT NOT NULL,
    "net_tx" BIGINT NOT NULL,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);
