import { env } from "$env/dynamic/private";
import { json, type RequestHandler } from "@sveltejs/kit";

const apiBaseUrl = env.API_BASE_URL ?? "http://localhost:3001";

export const GET: RequestHandler = async ({ fetch, params, url }) => {
  const nodeId = params.nodeId;
  const limit = url.searchParams.get("limit") ?? "60";

  try {
    const response = await fetch(`${apiBaseUrl}/nodes/${nodeId}/metrics?limit=${encodeURIComponent(limit)}`);
    const text = await response.text();

    if (!response.ok) {
      return json(
        {
          error: "Failed to load node metrics",
          status: response.status,
          details: text || null,
        },
        { status: response.status }
      );
    }

    const data = text ? JSON.parse(text) : { nodeId, metrics: [] };
    return json(data);
  } catch (error) {
    return json(
      {
        error: "Unable to reach API service",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
};
