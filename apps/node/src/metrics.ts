import os from "node:os";
import { statfs } from "node:fs/promises";

import { MetricsSchema, type MetricsPayload } from "@statix/shared";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function readDiskUsage() {
  try {
    const fs = await statfs("/");
    const blockSize = Number(fs.bsize);
    const totalBlocks = Number(fs.blocks);
    const freeBlocks = Number(fs.bfree);
    const total = blockSize * totalBlocks;
    const free = blockSize * freeBlocks;
    const used = Math.max(0, total - free);

    return {
      used: Number.isFinite(used) ? used : 0,
      total: Number.isFinite(total) && total > 0 ? total : 1,
    };
  } catch {
    return {
      used: 0,
      total: 1,
    };
  }
}

export async function collectMetrics(): Promise<MetricsPayload> {
  const cpuCount = Math.max(1, os.cpus().length);
  const load1m = os.loadavg()[0] ?? 0;
  const cpu = clamp(load1m / cpuCount, 0, 1);

  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = Math.max(0, memTotal - memFree);

  const disk = await readDiskUsage();

  const payload: MetricsPayload = {
    v: 1,
    ts: Date.now(),
    cpu,
    mem_used: memUsed,
    mem_total: Math.max(1, memTotal),
    disk_used: disk.used,
    disk_total: disk.total,
    // Scaffold values; replace with OS/network-interface counters in the real agent.
    net_rx: 0,
    net_tx: 0,
  };

  return MetricsSchema.parse(payload);
}
