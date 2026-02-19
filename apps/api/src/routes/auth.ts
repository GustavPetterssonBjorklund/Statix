import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { Passwords, Sessions } from "../user/auth.js";
import {
  AuthTokenStore,
  RoleStore,
  SessionStore,
  UserStore,
} from "../store/prisma.js";

function readBearerToken(rawHeader?: string) {
  if (!rawHeader) {
    return null;
  }

  const [scheme, token] = rawHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const emailSchema = z.string().trim().email();

function parseEmail(email: unknown) {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/bootstrap/status", async () => {
    const hasCredentialedAdmin = await UserStore.hasCredentialedAdmin();
    return { needsBootstrap: !hasCredentialedAdmin };
  });

  app.post("/auth/bootstrap/claim", async (request, reply) => {
    const body = request.body as
      | { token?: unknown; email?: unknown; password?: unknown; displayName?: unknown }
      | undefined;

    const token = body?.token;
    const email = body?.email;
    const password = body?.password;
    const displayName = body?.displayName;

    const parsedEmail = parseEmail(email);
    if (typeof token !== "string" || parsedEmail === null || typeof password !== "string") {
      return reply.status(400).send({ error: "token, email and password are required" });
    }

    const tokenHash = await Passwords.hashToken(token);
    const authToken = await AuthTokenStore.findUsableResetToken(tokenHash);

    if (!authToken) {
      return reply.status(401).send({ error: "invalid bootstrap token" });
    }
    const isBootstrapAdmin =
      authToken.user.passwordHash === null &&
      authToken.user.roles.some((entry) => entry.role.name === "admin");
    if (!isBootstrapAdmin) {
      return reply.status(403).send({ error: "token is not eligible for bootstrap claim" });
    }

    const passwordHash = await Passwords.hashPassword(password);
    const role = await RoleStore.ensureRole("admin", "Full administrative access");

    await UserStore.updateProfileAndPassword({
      userId: authToken.userId,
      email: parsedEmail,
      passwordHash,
      displayName: typeof displayName === "string" ? displayName : undefined,
    });
    await RoleStore.assignRole(authToken.userId, role.id);
    await AuthTokenStore.consumeToken(authToken.id);

    return { ok: true };
  });

  app.post("/auth/login", async (request, reply) => {
    const body = request.body as { email?: unknown; password?: unknown } | undefined;
    const email = body?.email;
    const password = body?.password;
    const parsedEmail = parseEmail(email);

    if (parsedEmail === null || typeof password !== "string") {
      return reply.status(400).send({ error: "email and password are required" });
    }

    const user = await UserStore.findByEmail(normalizeEmail(parsedEmail));
    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: "invalid credentials" });
    }

    const validPassword = await Passwords.verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      await UserStore.recordLoginFailure(user.id);
      return reply.status(401).send({ error: "invalid credentials" });
    }

    if (user.isDisabled) {
      return reply.status(403).send({ error: "account disabled" });
    }

    const sessionToken = await Sessions.createSession();
    await SessionStore.createSession({
      userId: user.id,
      tokenHash: sessionToken.tokenHash,
      expiresAt: sessionToken.expiresAt,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    await UserStore.recordLoginSuccess(user.id, request.ip);

    return {
      token: sessionToken.token,
      expiresAt: sessionToken.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles.map((entry) => entry.role.name),
      },
    };
  });

  app.get("/auth/me", async (request, reply) => {
    const bearerToken = readBearerToken(request.headers.authorization);
    if (!bearerToken) {
      return reply.status(401).send({ error: "missing bearer token" });
    }

    const tokenHash = await Passwords.hashToken(bearerToken);
    const session = await SessionStore.findActiveSessionByTokenHash(tokenHash);
    if (!session) {
      return reply.status(401).send({ error: "invalid session" });
    }

    await SessionStore.touchSession(session.id);

    return {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      roles: session.user.roles.map((entry) => entry.role.name),
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const bearerToken = readBearerToken(request.headers.authorization);
    if (!bearerToken) {
      return reply.status(401).send({ error: "missing bearer token" });
    }

    const tokenHash = await Passwords.hashToken(bearerToken);
    await SessionStore.revokeByTokenHash(tokenHash);
    return { ok: true };
  });

  app.post("/auth/users", async (request, reply) => {
    const bearerToken = readBearerToken(request.headers.authorization);
    if (!bearerToken) {
      return reply.status(401).send({ error: "missing bearer token" });
    }

    const tokenHash = await Passwords.hashToken(bearerToken);
    const session = await SessionStore.findActiveSessionByTokenHash(tokenHash);
    if (!session) {
      return reply.status(401).send({ error: "invalid session" });
    }

    const isAdmin = session.user.roles.some((entry) => entry.role.name === "admin");
    if (!isAdmin) {
      return reply.status(403).send({ error: "admin role required" });
    }

    const body = request.body as { email?: unknown; displayName?: unknown } | undefined;
    const email = body?.email;
    const displayName = body?.displayName;
    const parsedEmail = parseEmail(email);

    if (parsedEmail === null) {
      return reply.status(400).send({ error: "email is required" });
    }

    const newUser = await UserStore.createShellUser({
      email: parsedEmail,
      displayName: typeof displayName === "string" ? displayName : undefined,
    });

    const userRole = await RoleStore.ensureRole("user", "Default user role");
    await RoleStore.assignRole(newUser.id, userRole.id);

    const setupToken = await Passwords.resetPasswordToken();
    await AuthTokenStore.rotateResetToken(newUser.id, setupToken.tokenHash, setupToken.expiresAt);

    return reply.status(201).send({
      id: newUser.id,
      email: newUser.email,
      setupToken: setupToken.token,
      setupTokenExpiresAt: setupToken.expiresAt,
    });
  });

  app.post("/auth/set-password", async (request, reply) => {
    const body = request.body as { token?: unknown; password?: unknown } | undefined;
    const token = body?.token;
    const password = body?.password;

    if (typeof token !== "string" || typeof password !== "string") {
      return reply.status(400).send({ error: "token and password are required" });
    }

    const tokenHash = await Passwords.hashToken(token);
    const authToken = await AuthTokenStore.findUsableResetToken(tokenHash);
    if (!authToken) {
      return reply.status(401).send({ error: "invalid token" });
    }

    const passwordHash = await Passwords.hashPassword(password);
    await UserStore.updatePassword(authToken.userId, passwordHash);
    await AuthTokenStore.consumeToken(authToken.id);

    return { ok: true };
  });
};

export default authRoutes;
