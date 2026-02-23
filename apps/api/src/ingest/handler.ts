import { MetricsSchema, SystemInfoSchema } from "@statix/shared";

import { MetricStore, SystemInfoStore } from "../store/prisma.js";
import { parseNodeMetricsTopic, parseNodeSystemInfoTopic } from "./topic.js";

export async function handleMqttMessage(topic: string, payloadBuffer: Buffer) {
  const topicMatch = parseNodeMetricsTopic(topic);
  const systemInfoTopicMatch = parseNodeSystemInfoTopic(topic);
  if (!topicMatch && !systemInfoTopicMatch) {
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(payloadBuffer.toString("utf8"));
  } catch (error) {
    console.warn("[ingest] invalid JSON payload:", error);
    return;
  }

  if (topicMatch) {
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
    return;
  }

  if (systemInfoTopicMatch) {
    const parsed = SystemInfoSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[ingest] invalid system info payload:", parsed.error.message);
      return;
    }

    try {
      await SystemInfoStore.upsertNodeSystemInfo(systemInfoTopicMatch.nodeId, parsed.data);
    } catch (error) {
      console.warn("[ingest] failed to persist system info:", error);
    }
  }
}
