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
export declare const SystemInfoSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    ts: z.ZodNumber;
    hash: z.ZodString;
    info: z.ZodObject<{
        osPlatform: z.ZodString;
        osRelease: z.ZodString;
        osArch: z.ZodString;
        hostname: z.ZodString;
        cpuModel: z.ZodString;
        cpuCores: z.ZodNumber;
        memTotal: z.ZodNumber;
        agentVersion: z.ZodOptional<z.ZodString>;
        agentCommit: z.ZodOptional<z.ZodString>;
        agentBuiltAt: z.ZodOptional<z.ZodString>;
        gpus: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            vendor: z.ZodOptional<z.ZodString>;
            memoryBytes: z.ZodOptional<z.ZodNumber>;
            driverVersion: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type SystemInfoPayload = z.infer<typeof SystemInfoSchema>;
//# sourceMappingURL=index.d.ts.map