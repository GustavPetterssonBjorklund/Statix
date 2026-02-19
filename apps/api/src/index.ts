import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app.get("/health", async () => {
  return { ok: true };
});

app.get("/db/health", async (_, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    app.log.error(error);
    return reply.status(500).send({ ok: false });
  }
});

const start = async () => {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
