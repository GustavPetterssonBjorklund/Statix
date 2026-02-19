const METRICS_TOPIC_PATTERN = /^statix\/nodes\/([^/]+)\/metrics$/;

export function parseNodeMetricsTopic(topic: string) {
  const match = METRICS_TOPIC_PATTERN.exec(topic);
  if (!match) {
    return null;
  }

  return {
    nodeId: match[1],
  };
}
