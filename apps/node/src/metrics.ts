import os from "node:os";
import { readFile, statfs } from "node:fs/promises";

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

function parsePositiveNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function readMemInfoValueBytes(meminfo: Map<string, number>, key: string) {
  const value = meminfo.get(key);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return value * 1024;
}

async function readMemInfo() {
  try {
    const content = await readFile("/proc/meminfo", "utf8");
    const values = new Map<string, number>();
    for (const line of content.split("\n")) {
      const [rawKey, rawValue] = line.split(":");
      if (!rawKey || !rawValue) {
        continue;
      }

      const trimmedValue = rawValue.trim();
      const numericValue = Number(trimmedValue.split(/\s+/)[0]);
      if (Number.isFinite(numericValue) && numericValue >= 0) {
        values.set(rawKey.trim(), numericValue);
      }
    }
    return values;
  } catch {
    return null;
  }
}

type MemorySnapshot = {
  total: number;
  used: number;
  cached?: number;
  available?: number;
};

async function readCgroupMemoryV2() {
  try {
    const [maxRaw, currentRaw, statRaw] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.max", "utf8"),
      readFile("/sys/fs/cgroup/memory.current", "utf8"),
      readFile("/sys/fs/cgroup/memory.stat", "utf8"),
    ]);

    const maxTrimmed = maxRaw.trim();
    if (maxTrimmed === "max") {
      return null;
    }

    const total = parsePositiveNumber(maxTrimmed);
    const current = parsePositiveNumber(currentRaw);
    if (total === null || total <= 0 || current === null) {
      return null;
    }

    let cached: number | undefined;
    for (const line of statRaw.split("\n")) {
      const [key, value] = line.trim().split(/\s+/);
      if (key !== "file") {
        continue;
      }

      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        cached = parsed;
      }
      break;
    }

    const used = Math.max(0, Math.min(total, current));
    return {
      total,
      used,
      cached: typeof cached === "number" ? Math.max(0, Math.min(used, cached)) : undefined,
      available: Math.max(0, total - used),
    } satisfies MemorySnapshot;
  } catch {
    return null;
  }
}

async function readMemoryUsage(): Promise<MemorySnapshot> {
  const cgroup = await readCgroupMemoryV2();
  if (cgroup) {
    return cgroup;
  }

  const meminfo = await readMemInfo();
  if (meminfo) {
    const total = readMemInfoValueBytes(meminfo, "MemTotal");
    const available = readMemInfoValueBytes(meminfo, "MemAvailable");
    if (total !== null && total > 0 && available !== null) {
      const buffers = readMemInfoValueBytes(meminfo, "Buffers") ?? 0;
      const cached = readMemInfoValueBytes(meminfo, "Cached") ?? 0;
      const reclaimable = readMemInfoValueBytes(meminfo, "SReclaimable") ?? 0;
      const shmem = readMemInfoValueBytes(meminfo, "Shmem") ?? 0;
      const htopStyleCache = Math.max(0, buffers + cached + reclaimable - shmem);
      const used = Math.max(0, Math.min(total, total - available));
      return {
        total,
        used,
        cached: Math.min(used, htopStyleCache),
        available: Math.max(0, total - used),
      };
    }
  }

  const memTotal = Math.max(1, os.totalmem());
  const memFree = os.freemem();
  return {
    total: memTotal,
    used: Math.max(0, memTotal - memFree),
    available: Math.max(0, memFree),
  };
}

export async function collectMetrics(): Promise<MetricsPayload> {
  const cpuCount = Math.max(1, os.cpus().length);
  const load1m = os.loadavg()[0] ?? 0;
  const cpu = clamp(load1m / cpuCount, 0, 1);

  const memory = await readMemoryUsage();

  const disk = await readDiskUsage();

  const payload: MetricsPayload = {
    v: 1,
    ts: Date.now(),
    cpu,
    mem_used: memory.used,
    mem_total: Math.max(1, memory.total),
    ...(typeof memory.cached === "number" ? { mem_cached: memory.cached } : {}),
    ...(typeof memory.available === "number" ? { mem_available: memory.available } : {}),
    disk_used: disk.used,
    disk_total: disk.total,
    // Scaffold values; replace with OS/network-interface counters in the real agent.
    net_rx: 0,
    net_tx: 0,
  };

  return MetricsSchema.parse(payload);
}
