export type AgentConfig = {
  nodeId: string;
  nodeToken: string;
  apiBaseUrl: string;
  authExchangePath: string;
  publishTopic: string;
  publishIntervalMs: number;
  exchangeIntervalMs: number;
  reconnectDelayMs: number;
  connectTimeoutMs: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function loadConfig(): AgentConfig | null {
  const nodeId = process.env.NODE_ID?.trim();
  const nodeToken = process.env.NODE_TOKEN?.trim();
  if (!nodeId || !nodeToken) {
    return null;
  }

  const apiBaseUrl = trimTrailingSlash(process.env.API_BASE_URL?.trim() || "http://127.0.0.1:3001");
  const authExchangePath = process.env.NODE_AUTH_EXCHANGE_PATH?.trim() || "/nodes/auth/exchange";
  const topicTemplate = process.env.NODE_METRICS_TOPIC?.trim() || "statix/nodes/{nodeId}/metrics";
  const publishTopic = topicTemplate.replaceAll("{nodeId}", nodeId);

  return {
    nodeId,
    nodeToken,
    apiBaseUrl,
    authExchangePath,
    publishTopic,
    publishIntervalMs: parsePositiveInt(process.env.PUBLISH_INTERVAL_MS, 5_000),
    exchangeIntervalMs: parsePositiveInt(process.env.EXCHANGE_INTERVAL_MS, 15 * 60_000),
    reconnectDelayMs: parsePositiveInt(process.env.RECONNECT_DELAY_MS, 3_000),
    connectTimeoutMs: parsePositiveInt(process.env.MQTT_CONNECT_TIMEOUT_MS, 8_000),
  };
}
