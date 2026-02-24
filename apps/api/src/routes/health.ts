import type { FastifyPluginAsync } from "fastify";
import { dbHealthcheck } from "../store/prisma.js";
import { loadAppVersionMetadata } from "../version.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
	app.get("/health", async () => {
		const version = await loadAppVersionMetadata();
		return {
			ok: true,
			version: version ?? null,
		};
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
