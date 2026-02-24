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

async function requireAdminFromAuthorization(authHeader?: string) {
  const bearerToken = readBearerToken(authHeader);
  if (!bearerToken) {
    return { error: { status: 401, body: { error: "missing bearer token" } } };
  }

  const sessionTokenHash = await Passwords.hashToken(bearerToken);
  const session = await SessionStore.findActiveSessionByTokenHash(sessionTokenHash);
  if (!session) {
    return { error: { status: 401, body: { error: "invalid session" } } };
  }

  const isAdmin = session.user.roles.some((entry) => entry.role.name === "admin");
  if (!isAdmin) {
    return { error: { status: 403, body: { error: "admin role required" } } };
  }

  return { error: null };
}

const nodeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/nodes", async () => {
    const nodes = await listNodes();
    return nodes;
  });

  app.get("/nodes/:nodeId/metrics", async (request, reply) => {
    const params = request.params as { nodeId?: string } | undefined;
    const nodeId = params?.nodeId;
    if (!nodeId) {
      return reply.status(400).send({ error: "nodeId is required" });
    }

    const query = request.query as { limit?: unknown } | undefined;
    const parsedLimit =
      typeof query?.limit === "string" ? Number(query.limit) : typeof query?.limit === "number" ? query.limit : 60;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 60;

    const metrics = await MetricStore.listRecentByNode(nodeId, limit);
    return { nodeId, metrics };
  });

  app.post("/nodes/create", async (request, reply) => {
    const authResult = await requireAdminFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
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
    const authResult = await requireAdminFromAuthorization(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const params = request.params as { nodeId?: string } | undefined;
    const nodeId = params?.nodeId?.trim();
    if (!nodeId) {
      return reply.status(400).send({ error: "nodeId is required" });
    }

    const deleted = await NodeStore.deleteById(nodeId);
    if (!deleted) {
      return reply.status(404).send({ error: "node not found" });
    }

    markNodesChanged();
    return reply.status(204).send();
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
