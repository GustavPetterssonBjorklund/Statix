import { z } from "zod";
export declare const MetricsSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    ts: z.ZodNumber;
    cpu: z.ZodNumber;
    mem_used: z.ZodNumber;
    mem_total: z.ZodNumber;
    disk_used: z.ZodNumber;
    disk_total: z.ZodNumber;
    net_rx: z.ZodNumber;
    net_tx: z.ZodNumber;
}, z.core.$strip>;
export type MetricsPayload = z.infer<typeof MetricsSchema>;
//# sourceMappingURL=index.d.ts.map