export type MetricsPayload = {
  event: string;
  properties?: Record<string, any>;
};

export type Node = {
    id: string;
    name: string;
}