import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AppVersionMetadata = {
  version: string;
  commit?: string;
  builtAt?: string;
};

let cachedVersionMetadata: AppVersionMetadata | null | undefined;

export async function loadAppVersionMetadata(): Promise<AppVersionMetadata | null> {
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

  const envVersion = process.env.APP_VERSION?.trim();
  if (envVersion) {
    cachedVersionMetadata = {
      version: envVersion,
      commit: process.env.APP_COMMIT?.trim() || undefined,
      builtAt: process.env.APP_BUILT_AT?.trim() || undefined,
    };
    return cachedVersionMetadata;
  }

  cachedVersionMetadata = null;
  return null;
}
