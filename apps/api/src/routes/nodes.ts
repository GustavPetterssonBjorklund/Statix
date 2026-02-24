import type { FastifyPluginAsync } from "fastify";
import { Passwords } from "../user/auth.js";
import { MetricStore, NodeStore, SessionStore, createNode, listNodes } from "../store/prisma.js";
import { markNodesChanged } from "../realtime/nodes.js";

function readBearerToken(rawHeader?: string) {
  if (!rawHeader) {
    return null;
  }

  const [scheme, token] = rawHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

type ActiveSession = NonNullable<Awaited<ReturnType<typeof SessionStore.findActiveSessionByTokenHash>>>;

function getSessionPermissionCodes(session: ActiveSession) {
  const codes = new Set<string>();
  for (const userRole of session.user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      codes.add(rolePermission.permission.code);
    }
  }
  return codes;
}

function sessionHasPermission(
  session: ActiveSession,
  permissionCode: string
) {
  return getSessionPermissionCodes(session).has(permissionCode);
}

function sessionCanReadNode(session: ActiveSession, nodeId: string) {
  if (sessionHasPermission(session, "nodes:read")) {
    return true;
  }

  return sessionHasPermission(session, `node:read:${nodeId}`);
}

function sessionCanWriteNode(session: ActiveSession, nodeId: string) {
  if (sessionHasPermission(session, "nodes:delete")) {
    return true;
  }

  return sessionHasPermission(session, `node:write:${nodeId}`);
}

function getReadableNodeIds(session: ActiveSession) {
  const readable = new Set<string>();
  for (const code of getSessionPermissionCodes(session)) {
    if (!code.startsWith("node:read:")) {
      continue;
    }

    const nodeId = code.slice("node:read:".length);
    if (nodeId) {
      readable.add(nodeId);
    }
  }
  return readable;
}

async function requireSessionFromAuthorization(authHeader: string | undefined) {
  const bearerToken = readBearerToken(authHeader);
  if (!bearerToken) {
    return { session: null, error: { status: 401, body: { error: "missing bearer token" } } };
  }

  const sessionTokenHash = await Passwords.hashToken(bearerToken);
  const session = await SessionStore.findActiveSessionByTokenHash(sessionTokenHash);
  if (!session) {
    return { session: null, error: { status: 401, body: { error: "invalid session" } } };
  }

  return { session, error: null };
}

const nodeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/nodes", async (request, reply) => {
    const authResult = await requireSessionFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const session = authResult.session;
    if (!session) {
      return reply.status(401).send({ error: "invalid session" });
    }

    const nodes = await listNodes();
    if (sessionHasPermission(session, "nodes:read")) {
      return nodes;
    }

    const readableNodeIds = getReadableNodeIds(session);
    if (readableNodeIds.size === 0) {
      return reply.status(403).send({ error: "permission required: nodes:read or node:read:<nodeId>" });
    }

    return nodes.filter((node) => readableNodeIds.has(node.id));
  });

  app.get("/nodes/:nodeId/metrics", async (request, reply) => {
    const authResult = await requireSessionFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const params = request.params as { nodeId?: string } | undefined;
    const nodeId = params?.nodeId;
    if (!nodeId) {
      return reply.status(400).send({ error: "nodeId is required" });
    }

    const session = authResult.session;
    if (!session || !sessionCanReadNode(session, nodeId)) {
      return reply.status(403).send({ error: `permission required: nodes:read or node:read:${nodeId}` });
    }

    const query = request.query as { limit?: unknown } | undefined;
    const parsedLimit =
      typeof query?.limit === "string" ? Number(query.limit) : typeof query?.limit === "number" ? query.limit : 60;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 60;

    const metrics = await MetricStore.listRecentByNode(nodeId, limit);
    return { nodeId, metrics };
  });

  app.post("/nodes/create", async (request, reply) => {
    const authResult = await requireSessionFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const session = authResult.session;
    if (!session || !sessionHasPermission(session, "nodes:create")) {
      return reply.status(403).send({ error: "permission required: nodes:create" });
    }

    const body = request.body as { name?: unknown } | undefined;
    const name = body?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return reply.status(400).send({ error: "name is required" });
    }

    const nodeToken = await Passwords.createNodeToken();
    const createdNode = await createNode({
      name: name.trim(),
      authTokenHash: nodeToken.tokenHash,
    });
    markNodesChanged();
    const envFile = [
      `NODE_ID=${createdNode.id}`,
      `NODE_TOKEN=${nodeToken.token}`,
      "API_BASE_URL=http://127.0.0.1:3001",
      "NODE_AUTH_EXCHANGE_PATH=/nodes/auth/exchange",
      "NODE_METRICS_TOPIC=statix/nodes/{nodeId}/metrics",
      "NODE_SYSTEM_INFO_TOPIC=statix/nodes/{nodeId}/system",
      "PUBLISH_INTERVAL_MS=5000",
      "SYSTEM_INFO_CHECK_INTERVAL_MS=600000",
      "SYSTEM_INFO_REPUBLISH_INTERVAL_MS=86400000",
      "EXCHANGE_INTERVAL_MS=900000",
      "RECONNECT_DELAY_MS=3000",
      "MQTT_CONNECT_TIMEOUT_MS=8000",
    ].join("\n");

    return reply.status(201).send({
      id: createdNode.id,
      name: createdNode.name,
      createdAt: createdNode.createdAt,
      token: nodeToken.token,
      envFile,
    });
  });

  app.delete("/nodes/:nodeId", async (request, reply) => {
    const authResult = await requireSessionFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const params = request.params as { nodeId?: string } | undefined;
    const nodeId = params?.nodeId?.trim();
    if (!nodeId) {
      return reply.status(400).send({ error: "nodeId is required" });
    }

    const session = authResult.session;
    if (!session || !sessionCanWriteNode(session, nodeId)) {
      return reply.status(403).send({ error: `permission required: nodes:delete or node:write:${nodeId}` });
    }

    const deleted = await NodeStore.deleteById(nodeId);
    if (!deleted) {
      return reply.status(404).send({ error: "node not found" });
    }

    markNodesChanged();
    return reply.status(204).send();
  });

  app.patch("/nodes/:nodeId", async (request, reply) => {
    const authResult = await requireSessionFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const params = request.params as { nodeId?: string } | undefined;
    const nodeId = params?.nodeId?.trim();
    if (!nodeId) {
      return reply.status(400).send({ error: "nodeId is required" });
    }

    const session = authResult.session;
    if (!session || !sessionCanWriteNode(session, nodeId)) {
      return reply.status(403).send({ error: `permission required: nodes:delete or node:write:${nodeId}` });
    }

    const body = request.body as { name?: unknown } | undefined;
    if (typeof body?.name !== "string") {
      return reply.status(400).send({ error: "name is required" });
    }

    const name = body.name.trim();
    const updatedNode = await NodeStore.updateNameById(nodeId, name.length > 0 ? name : null);
    if (!updatedNode) {
      return reply.status(404).send({ error: "node not found" });
    }

    markNodesChanged();
    return {
      id: updatedNode.id,
      name: updatedNode.name,
      createdAt: updatedNode.createdAt,
      updatedAt: updatedNode.updatedAt,
    };
  });

  app.post("/nodes/auth/exchange", async (request, reply) => {
    const body = request.body as { nodeId?: unknown; nodeToken?: unknown } | undefined;
    const nodeId = body?.nodeId;
    const nodeToken = body?.nodeToken;

    if (typeof nodeId !== "string" || typeof nodeToken !== "string") {
      return reply.status(400).send({ error: "nodeId and nodeToken are required" });
    }

    const node = await NodeStore.findById(nodeId);
    if (!node?.authTokenHash) {
      return reply.status(401).send({ error: "invalid node credentials" });
    }

    const providedTokenHash = await Passwords.hashToken(nodeToken);
    if (providedTokenHash !== node.authTokenHash) {
      return reply.status(401).send({ error: "invalid node credentials" });
    }

    const mqttHost = process.env.MQTT_HOST ?? "127.0.0.1";
    const mqttPort = Number(process.env.MQTT_PORT ?? 1883);
    const mqttUsername = process.env.MQTT_USERNAME ?? "statix-node";
    const mqttPassword = process.env.MQTT_PASSWORD ?? "change-me-dev";

    return {
      mqtt: {
        host: mqttHost,
        port: mqttPort,
        username: mqttUsername,
        password: mqttPassword,
        expiresAt: null,
      },
    };
  });
};

export default nodeRoutes;
