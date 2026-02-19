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
