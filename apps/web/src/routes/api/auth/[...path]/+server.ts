import { env } from "$env/dynamic/private";
import type { RequestHandler } from "@sveltejs/kit";

function buildApiUrl(path: string, query: string) {
  const base = env.API_BASE_URL ?? "http://localhost:3001";
  const trimmed = path.replace(/^\/+/, "");
  return `${base}/auth/${trimmed}${query}`;
}

async function proxyRequest(method: "GET" | "POST", event: Parameters<RequestHandler>[0]) {
  const path = event.params.path ?? "";
  const targetUrl = buildApiUrl(path, event.url.search);

  const headers = new Headers();
  const authorization = event.request.headers.get("authorization");
  if (authorization) {
    headers.set("authorization", authorization);
  }

  let body: string | undefined;
  if (method === "POST") {
    body = await event.request.text();
    const contentType = event.request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    } else {
      headers.set("content-type", "application/json");
    }
  }

  const response = await fetch(targetUrl, {
    method,
    headers,
    body,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
}

export const GET: RequestHandler = async (event) => proxyRequest("GET", event);
export const POST: RequestHandler = async (event) => proxyRequest("POST", event);
