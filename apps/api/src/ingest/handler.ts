import { MetricsSchema } from "@statix/shared";

import { MetricStore } from "../store/prisma.js";
import { parseNodeMetricsTopic } from "./topic.js";

export async function handleMqttMessage(topic: string, payloadBuffer: Buffer) {
  const topicMatch = parseNodeMetricsTopic(topic);
  if (!topicMatch) {
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(payloadBuffer.toString("utf8"));
  } catch (error) {
    console.warn("[ingest] invalid JSON payload:", error);
    return;
  }

  const parsed = MetricsSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[ingest] invalid metrics payload:", parsed.error.message);
    return;
  }

  try {
    await MetricStore.appendNodeMetric(topicMatch.nodeId, parsed.data);
  } catch (error) {
    console.warn("[ingest] failed to persist metrics:", error);
  }
}
