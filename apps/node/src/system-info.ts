import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { SystemInfoSchema, type SystemInfoPayload } from "@statix/shared";

const execFileAsync = promisify(execFile);

type GpuInfo = {
  name: string;
  vendor?: string;
  memoryBytes?: number;
  driverVersion?: string;
};

type VersionMetadata = {
  version: string;
  commit?: string;
  builtAt?: string;
};

let cachedVersionMetadata: VersionMetadata | null | undefined;

async function loadVersionMetadata(): Promise<VersionMetadata | null> {
  if (cachedVersionMetadata !== undefined) {
    return cachedVersionMetadata;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.STATIX_VERSION_FILE?.trim(),
    resolve(moduleDir, "../version.json"),
    resolve(process.cwd(), "version.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown; commit?: unknown; builtAt?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
        cachedVersionMetadata = {
          version: parsed.version.trim(),
          commit: typeof parsed.commit === "string" ? parsed.commit.trim() : undefined,
          builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt.trim() : undefined,
        };
        return cachedVersionMetadata;
      }
    } catch {
      // try next candidate
    }
  }

  cachedVersionMetadata = null;
  return null;
}

async function tryCollectNvidiaSmiGpus(): Promise<GpuInfo[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
      { timeout: 2_500, windowsHide: true }
    );

    const gpus = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [nameRaw, memoryMbRaw, driverVersionRaw] = line.split(",").map((part) => part.trim());
        const memoryMb = Number(memoryMbRaw);
        return {
          name: nameRaw || "NVIDIA GPU",
          vendor: "NVIDIA",
          memoryBytes: Number.isFinite(memoryMb) && memoryMb > 0 ? Math.trunc(memoryMb * 1024 * 1024) : undefined,
          driverVersion: driverVersionRaw || undefined,
        } satisfies GpuInfo;
      });

    return gpus.length > 0 ? gpus : null;
  } catch {
    return null;
  }
}

async function tryCollectLinuxPciGpus(): Promise<GpuInfo[] | null> {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("lspci", [], { timeout: 2_500, windowsHide: true });
    const gpus = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /vga compatible controller|3d controller|display controller/i.test(line))
      .map((line) => {
        const descriptor = line.replace(/^[^:]+:\s*/u, "");
        const name = descriptor || "GPU";
        let vendor: string | undefined;
        if (/nvidia/i.test(descriptor)) {
          vendor = "NVIDIA";
        } else if (/amd|advanced micro devices|ati/i.test(descriptor)) {
          vendor = "AMD";
        } else if (/intel/i.test(descriptor)) {
          vendor = "Intel";
        }
        return { name, vendor } satisfies GpuInfo;
      });

    return gpus.length > 0 ? gpus : null;
  } catch {
    return null;
  }
}

async function collectGpuInfo(): Promise<GpuInfo[]> {
  const nvidia = await tryCollectNvidiaSmiGpus();
  if (nvidia) {
    return nvidia;
  }

  const linuxPci = await tryCollectLinuxPciGpus();
  if (linuxPci) {
    return linuxPci;
  }

  return [];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createInfoHash(info: SystemInfoPayload["info"]) {
  return createHash("sha256").update(stableStringify(info)).digest("hex");
}

export async function collectSystemInfo(): Promise<SystemInfoPayload> {
  const cpus = os.cpus();
  const versionMetadata = await loadVersionMetadata();
  const info: SystemInfoPayload["info"] = {
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCores: Math.max(1, cpus.length),
    memTotal: Math.max(1, os.totalmem()),
    agentVersion: versionMetadata?.version,
    agentCommit: versionMetadata?.commit,
    agentBuiltAt: versionMetadata?.builtAt,
    gpus: await collectGpuInfo(),
  };

  const payload: SystemInfoPayload = {
    v: 1,
    ts: Date.now(),
    hash: createInfoHash(info),
    info,
  };

  return SystemInfoSchema.parse(payload);
}
