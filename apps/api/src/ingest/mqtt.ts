import mqtt, { type MqttClient } from "mqtt";

import { handleMqttMessage } from "./handler.js";

export function startMqttIngest() {
  const host = process.env.MQTT_HOST ?? "127.0.0.1";
  const port = Number(process.env.MQTT_PORT ?? 1883);
  const username = process.env.MQTT_USERNAME ?? "statix-node";
  const password = process.env.MQTT_PASSWORD ?? "change-me-dev";
  const topicFilter = process.env.MQTT_METRICS_TOPIC_FILTER ?? "statix/nodes/+/+";
  const protocol = port === 9001 ? "ws" : "mqtt";

  const client: MqttClient = mqtt.connect({
    protocol,
    host,
    port,
    username,
    password,
    clientId: `statix-api-ingest-${Math.random().toString(36).slice(2, 10)}`,
    reconnectPeriod: 2_000,
  });

  client.on("connect", () => {
    console.log(`[ingest] connected to mqtt://${host}:${port}`);
    client.subscribe(topicFilter, { qos: 1 }, (error) => {
      if (error) {
        console.error("[ingest] subscribe failed:", error);
        return;
      }
      console.log(`[ingest] subscribed to ${topicFilter}`);
    });
  });

  client.on("message", (topic, payload) => {
    void handleMqttMessage(topic, payload);
  });

  client.on("error", (error) => {
    console.error("[ingest] mqtt error:", error);
  });

  client.on("close", () => {
    console.warn("[ingest] mqtt connection closed");
  });

  return client;
}
