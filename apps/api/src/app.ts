import Fastify from "fastify";
import healthRoutes from "./routes/health.js";
import nodeRoutes from "./routes/nodes.js";
import authRoutes from "./routes/auth.js";
import { startMqttIngest } from "./ingest/mqtt.js";
import { startNodesRealtime } from "./realtime/nodes.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

// Routes:
// `/health`
// `/db/health`
await app.register(healthRoutes);

// Routes:
// `/nodes`
await app.register(nodeRoutes);

// Routes:
// `/auth/*`
await app.register(authRoutes);


const start = async () => {
  try {
    startNodesRealtime(app.server);
    startMqttIngest();
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
