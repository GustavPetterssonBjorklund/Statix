const METRICS_TOPIC_PATTERN = /^statix\/nodes\/([^/]+)\/metrics$/;
const SYSTEM_INFO_TOPIC_PATTERN = /^statix\/nodes\/([^/]+)\/system$/;

export function parseNodeMetricsTopic(topic: string) {
  const match = METRICS_TOPIC_PATTERN.exec(topic);
  if (!match) {
    return null;
  }

  return {
    nodeId: match[1],
  };
}

export function parseNodeSystemInfoTopic(topic: string) {
  const match = SYSTEM_INFO_TOPIC_PATTERN.exec(topic);
  if (!match) {
    return null;
  }

  return {
    nodeId: match[1],
  };
}
