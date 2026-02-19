import mqtt, { type MqttClient } from "mqtt";

import { exchangeNodeToken, type BrokerCredentials } from "./api.js";
import { loadConfig } from "./config.js";
import { collectMetrics } from "./metrics.js";

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

function publishAsync(client: MqttClient, topic: string, payload: string) {
  return new Promise<void>((resolve, reject) => {
    client.publish(topic, payload, { qos: 1 }, (error) => {
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
  publishTopic: string,
  publishIntervalMs: number,
  exchangeIntervalMs: number,
  connectTimeoutMs: number,
  refreshCredentials: () => Promise<BrokerCredentials>
) {
  return new Promise<BrokerCredentials | null>((resolve) => {
    let rotateTo: BrokerCredentials | null = null;
    let publishTimer: NodeJS.Timeout | null = null;
    let refreshTimer: NodeJS.Timeout | null = null;
    let publishInFlight = false;

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
      publishTimer = null;
      refreshTimer = null;
    };

    const publishOnce = async () => {
      if (publishInFlight || !client.connected) {
        return;
      }
      publishInFlight = true;

      try {
        const metrics = await collectMetrics();
        await publishAsync(client, publishTopic, JSON.stringify(metrics));
      } catch (error) {
        console.error("[node-agent] publish failed:", error);
      } finally {
        publishInFlight = false;
      }
    };

    client.on("connect", () => {
      console.log(`[node-agent] connected to mqtt://${credentials.host}:${credentials.port}`);
      void publishOnce();
      publishTimer = setInterval(() => {
        void publishOnce();
      }, publishIntervalMs);

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
        config.publishTopic,
        config.publishIntervalMs,
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
