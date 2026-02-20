import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import { listNodes } from "../store/prisma.js";

type NodesSnapshotMessage = {
  type: "nodes_snapshot";
  nodes: Awaited<ReturnType<typeof listNodes>>;
};

const clients = new Set<WebSocket>();

let broadcastTimer: NodeJS.Timeout | null = null;

function sendJson(ws: WebSocket, payload: NodesSnapshotMessage) {
  if (ws.readyState !== ws.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

async function sendSnapshot(ws: WebSocket) {
  const nodes = await listNodes();
  sendJson(ws, {
    type: "nodes_snapshot",
    nodes,
  });
}

async function broadcastSnapshot() {
  if (clients.size === 0) {
    return;
  }

  const nodes = await listNodes();
  const payload: NodesSnapshotMessage = {
    type: "nodes_snapshot",
    nodes,
  };
  for (const client of clients) {
    sendJson(client, payload);
  }
}

export function markNodesChanged() {
  if (broadcastTimer) {
    return;
  }

  // Coalesce bursts of updates into a single snapshot push.
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    try {
      await broadcastSnapshot();
    } catch (error) {
      console.error("[realtime] failed to broadcast nodes snapshot:", error);
    }
  }, 150);
}

export function startNodesRealtime(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    clients.add(ws);
    void sendSnapshot(ws).catch((error) => {
      console.error("[realtime] failed to send initial snapshot:", error);
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (request.url !== "/ws/nodes") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
}
