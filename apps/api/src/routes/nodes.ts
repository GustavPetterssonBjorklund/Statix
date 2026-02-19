import type { FastifyPluginAsync } from "fastify";
import { createNode, listNodes } from "../store/prisma.js";

const nodeRoutes: FastifyPluginAsync = async (app) => {
    // Return all nodes
    app.get("/nodes", async () => {
        const nodes = await listNodes();
        return nodes;
    });

    app.post("/nodes/create", async (request, reply) => {
        const body = request.body as { name?: unknown } | undefined;
        const name = body?.name;

        if (typeof name !== "string" || name.trim().length === 0) {
            return reply.status(400).send({ error: "name is required" });
        }

        const createdNode = await createNode(name.trim());
        return reply.status(201).send(createdNode);
    });
};

export default nodeRoutes;
