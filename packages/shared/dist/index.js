import { z } from "zod";
export const MetricsSchema = z.object({
    v: z.literal(1),
    ts: z.number(), // unix seconds or ms—pick one convention
    cpu: z.number().min(0).max(1),
    mem_used: z.number().nonnegative(),
    mem_total: z.number().positive(),
    disk_used: z.number().nonnegative(),
    disk_total: z.number().positive(),
    net_rx: z.number().nonnegative(),
    net_tx: z.number().nonnegative()
});
const GpuSchema = z.object({
    name: z.string().min(1),
    vendor: z.string().optional(),
    memoryBytes: z.number().int().nonnegative().optional(),
    driverVersion: z.string().optional()
});
export const SystemInfoSchema = z.object({
    v: z.literal(1),
    ts: z.number(),
    hash: z.string().min(1),
    info: z.object({
        osPlatform: z.string().min(1),
        osRelease: z.string().min(1),
        osArch: z.string().min(1),
        hostname: z.string().min(1),
        cpuModel: z.string().min(1),
        cpuCores: z.number().int().positive(),
        memTotal: z.number().positive(),
        agentVersion: z.string().min(1).optional(),
        agentCommit: z.string().optional(),
        agentBuiltAt: z.string().optional(),
        gpus: z.array(GpuSchema)
    })
});
