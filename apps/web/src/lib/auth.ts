import { browser } from "$app/environment";

const TOKEN_KEY = "statix.auth.token";

export function getAuthToken() {
  if (!browser) {
    return null;
  }

  const token = localStorage.getItem(TOKEN_KEY);
  return token && token.trim().length > 0 ? token : null;
}

export function setAuthToken(token: string) {
  if (!browser) {
    return;
  }

  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  if (!browser) {
    return;
  }

  localStorage.removeItem(TOKEN_KEY);
}

export async function validateAuthToken(token: string) {
  const response = await fetch("/api/auth/me", {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const user = await response.json();
  return user;
}
