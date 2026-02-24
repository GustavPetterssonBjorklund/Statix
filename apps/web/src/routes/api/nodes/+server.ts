import { env } from "$env/dynamic/private";
import { json, type RequestHandler } from "@sveltejs/kit";

const apiBaseUrl = env.API_BASE_URL ?? "http://localhost:3001";

export const GET: RequestHandler = async ({ fetch, request }) => {
  const authHeader = request.headers.get("authorization");

  try {
    const response = await fetch(`${apiBaseUrl}/nodes`, {
      headers: authHeader ? { authorization: authHeader } : {},
    });
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

export const POST: RequestHandler = async ({ fetch, request }) => {
  try {
    const body = await request.text();
    const authHeader = request.headers.get("authorization");

    const response = await fetch(`${apiBaseUrl}/nodes/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body,
    });
    const text = await response.text();

    if (!response.ok) {
      return json(
        {
          error: "Failed to create node",
          status: response.status,
          details: text || null,
        },
        { status: response.status }
      );
    }

    const data = text ? JSON.parse(text) : null;
    return json(data, { status: 201 });
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
