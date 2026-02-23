import { env } from "$env/dynamic/public";

type NodesSnapshotMessage<TNode> = {
  type: "nodes_snapshot";
  nodes: TNode[];
};

function resolveNodesWsUrl() {
  const configured = env.PUBLIC_NODES_WS_URL?.trim();
  if (configured) {
    return configured;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/nodes`;
}

export function connectLiveNodes<TNode>(
  onNodes: (nodes: TNode[]) => void,
  onError?: (error: string) => void
) {
  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) {
      return;
    }

    const url = resolveNodesWsUrl();
    ws = new WebSocket(url);

    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as NodesSnapshotMessage<TNode>;
        if (parsed?.type !== "nodes_snapshot" || !Array.isArray(parsed.nodes)) {
          return;
        }
        onNodes(parsed.nodes);
      } catch {
        // Ignore malformed websocket payloads.
      }
    });

    ws.addEventListener("error", () => {
      onError?.("Live updates disconnected");
    });

    ws.addEventListener("close", () => {
      if (stopped) {
        return;
      }
      reconnectTimer = setTimeout(connect, 1500);
    });
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    ws?.close();
  };
}
