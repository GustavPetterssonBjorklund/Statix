import { env } from "$env/dynamic/private";
import { json, type RequestHandler } from "@sveltejs/kit";

const apiBaseUrl = env.API_BASE_URL ?? "http://localhost:3001";

export const GET: RequestHandler = async ({ fetch }) => {
  try {
    const response = await fetch(`${apiBaseUrl}/nodes`);
    const text = await response.text();

    if (!response.ok) {
      return json(
        {
          error: "Failed to load nodes",
          status: response.status,
          details: text || null,
        },
        { status: response.status }
      );
    }

    const data = text ? JSON.parse(text) : [];
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
