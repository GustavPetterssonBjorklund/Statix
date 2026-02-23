import mqtt, { type MqttClient } from "mqtt";

import { exchangeNodeToken, type BrokerCredentials } from "./api.js";
import { loadConfig } from "./config.js";
import { collectMetrics } from "./metrics.js";
import { collectSystemInfo } from "./system-info.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameCredentials(a: BrokerCredentials, b: BrokerCredentials) {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.password === b.password
  );
}

function publishAsync(client: MqttClient, topic: string, payload: string, options?: { retain?: boolean }) {
  return new Promise<void>((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain: options?.retain ?? false }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runSession(
  credentials: BrokerCredentials,
  metricsTopic: string,
  systemInfoTopic: string,
  publishIntervalMs: number,
  systemInfoCheckIntervalMs: number,
  systemInfoRepublishIntervalMs: number,
  exchangeIntervalMs: number,
  connectTimeoutMs: number,
  refreshCredentials: () => Promise<BrokerCredentials>
) {
  return new Promise<BrokerCredentials | null>((resolve) => {
    let rotateTo: BrokerCredentials | null = null;
    let publishTimer: NodeJS.Timeout | null = null;
    let systemInfoTimer: NodeJS.Timeout | null = null;
    let refreshTimer: NodeJS.Timeout | null = null;
    let publishInFlight = false;
    let systemInfoInFlight = false;
    let lastSystemInfoHash: string | null = null;
    let lastSystemInfoPublishedAt = 0;

    const protocol = credentials.port === 9001 ? "ws" : "mqtt";
    const client = mqtt.connect({
      protocol,
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      password: credentials.password,
      connectTimeout: connectTimeoutMs,
      reconnectPeriod: 0,
      clientId: `statix-node-${Math.random().toString(36).slice(2, 12)}`,
    });

    const cleanup = () => {
      if (publishTimer) {
        clearInterval(publishTimer);
      }
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      if (systemInfoTimer) {
        clearInterval(systemInfoTimer);
      }
      publishTimer = null;
      refreshTimer = null;
      systemInfoTimer = null;
    };

    const publishOnce = async () => {
      if (publishInFlight || !client.connected) {
        return;
      }
      publishInFlight = true;

      try {
        const metrics = await collectMetrics();
        await publishAsync(client, metricsTopic, JSON.stringify(metrics));
      } catch (error) {
        console.error("[node-agent] publish failed:", error);
      } finally {
        publishInFlight = false;
      }
    };

    const publishSystemInfoIfNeeded = async (force = false) => {
      if (systemInfoInFlight || !client.connected) {
        return;
      }
      systemInfoInFlight = true;

      try {
        const systemInfo = await collectSystemInfo();
        const now = Date.now();
        const shouldRepublishForFreshness =
          now - lastSystemInfoPublishedAt >= systemInfoRepublishIntervalMs;
        const hasChanged = systemInfo.hash !== lastSystemInfoHash;

        if (force || hasChanged || shouldRepublishForFreshness) {
          await publishAsync(client, systemInfoTopic, JSON.stringify(systemInfo), { retain: true });
          lastSystemInfoHash = systemInfo.hash;
          lastSystemInfoPublishedAt = now;
        }
      } catch (error) {
        console.error("[node-agent] system info publish failed:", error);
      } finally {
        systemInfoInFlight = false;
      }
    };

    client.on("connect", () => {
      console.log(`[node-agent] connected to mqtt://${credentials.host}:${credentials.port}`);
      void publishOnce();
      void publishSystemInfoIfNeeded(true);
      publishTimer = setInterval(() => {
        void publishOnce();
      }, publishIntervalMs);
      systemInfoTimer = setInterval(() => {
        void publishSystemInfoIfNeeded(false);
      }, systemInfoCheckIntervalMs);

      refreshTimer = setInterval(() => {
        void (async () => {
          try {
            const nextCredentials = await refreshCredentials();
            if (!sameCredentials(nextCredentials, credentials)) {
              rotateTo = nextCredentials;
              client.end(true);
            }
          } catch (error) {
            console.error("[node-agent] credential refresh failed:", error);
          }
        })();
      }, exchangeIntervalMs);
    });

    client.on("error", (error) => {
      console.error("[node-agent] mqtt error:", error);
    });

    client.on("close", () => {
      cleanup();
      resolve(rotateTo);
    });
  });
}

async function main() {
  const config = loadConfig();
  if (!config) {
    console.error(
      "[node-agent] NODE_ID and NODE_TOKEN are required. Set them in env before starting."
    );
    process.exitCode = 1;
    return;
  }

  console.log("[node-agent] starting with nodeId:", config.nodeId);

  let stopRequested = false;
  process.on("SIGINT", () => {
    stopRequested = true;
  });
  process.on("SIGTERM", () => {
    stopRequested = true;
  });

  let nextCredentials: BrokerCredentials | null = null;

  while (!stopRequested) {
    try {
      const currentCredentials = nextCredentials ?? (await exchangeNodeToken(config));
      nextCredentials = await runSession(
        currentCredentials,
        config.metricsTopic,
        config.systemInfoTopic,
        config.publishIntervalMs,
        config.systemInfoCheckIntervalMs,
        config.systemInfoRepublishIntervalMs,
        config.exchangeIntervalMs,
        config.connectTimeoutMs,
        () => exchangeNodeToken(config)
      );
    } catch (error) {
      console.error("[node-agent] session failed:", error);
    }

    if (!stopRequested) {
      await sleep(config.reconnectDelayMs);
    }
  }

  console.log("[node-agent] stopped");
}

void main();
