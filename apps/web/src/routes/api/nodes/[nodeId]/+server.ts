import { env } from "$env/dynamic/private";
import { json, type RequestHandler } from "@sveltejs/kit";

const apiBaseUrl = env.API_BASE_URL ?? "http://localhost:3001";

export const DELETE: RequestHandler = async ({ fetch, params, request }) => {
	const nodeId = params.nodeId;
	const authHeader = request.headers.get("authorization");

	if (!nodeId) {
		return json({ error: "nodeId is required" }, { status: 400 });
	}

	try {
		const response = await fetch(`${apiBaseUrl}/nodes/${encodeURIComponent(nodeId)}`, {
			method: "DELETE",
			headers: authHeader ? { authorization: authHeader } : {}
		});

		if (!response.ok) {
			const text = await response.text();
			return json(
				{
					error: "Failed to delete node",
					status: response.status,
					details: text || null
				},
				{ status: response.status }
			);
		}

		return new Response(null, { status: 204 });
	} catch (error) {
		return json(
			{
				error: "Unable to reach API service",
				details: error instanceof Error ? error.message : "Unknown error"
			},
			{ status: 502 }
		);
	}
};
