import type { FastifyPluginAsync } from "fastify";
import { dbHealthcheck } from "../store/prisma.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
	app.get("/health", async () => {
		return { ok: true };
	});

	app.get("/db/health", async (_, reply) => {
		try {
			await dbHealthcheck();
			return { ok: true };
		} catch (error) {
			app.log.error(error);
			return reply.status(500).send({ ok: false });
		}
	});
};

export default healthRoutes;
