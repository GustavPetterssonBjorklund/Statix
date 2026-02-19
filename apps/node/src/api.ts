import type { AgentConfig } from "./config.js";

export type BrokerCredentials = {
  host: string;
  port: number;
  username: string;
  password: string;
  expiresAt: string | null;
};

type ExchangeResponse = {
  mqtt?: {
    host?: unknown;
    port?: unknown;
    username?: unknown;
    password?: unknown;
    expiresAt?: unknown;
  };
};

export async function exchangeNodeToken(config: AgentConfig): Promise<BrokerCredentials> {
  const response = await fetch(`${config.apiBaseUrl}${config.authExchangePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      nodeId: config.nodeId,
      nodeToken: config.nodeToken,
    }),
  });

  const text = await response.text();
  let payload: ExchangeResponse = {};
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as ExchangeResponse;
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    throw new Error(`exchange failed (${response.status}): ${text || "unknown error"}`);
  }

  const mqtt = payload.mqtt;
  if (!mqtt) {
    throw new Error("exchange response missing mqtt payload");
  }

  if (typeof mqtt.host !== "string" || mqtt.host.length === 0) {
    throw new Error("exchange response missing mqtt.host");
  }
  if (typeof mqtt.port !== "number" || !Number.isFinite(mqtt.port) || mqtt.port <= 0) {
    throw new Error("exchange response missing mqtt.port");
  }
  if (typeof mqtt.username !== "string" || mqtt.username.length === 0) {
    throw new Error("exchange response missing mqtt.username");
  }
  if (typeof mqtt.password !== "string" || mqtt.password.length === 0) {
    throw new Error("exchange response missing mqtt.password");
  }

  return {
    host: mqtt.host,
    port: mqtt.port,
    username: mqtt.username,
    password: mqtt.password,
    expiresAt: typeof mqtt.expiresAt === "string" ? mqtt.expiresAt : null,
  };
}
