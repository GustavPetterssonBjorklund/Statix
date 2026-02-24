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
const roleNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9:_-]*$/);

function parseEmail(email: unknown) {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function parseRoleName(name: unknown) {
  const parsed = roleNameSchema.safeParse(name);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    items.push(trimmed);
  }

  return [...new Set(items)];
}

const nodeScopedPermissionPattern = /^node:(read|write):([a-zA-Z0-9_-]+)$/;

function isSupportedDynamicPermissionCode(code: string) {
  return nodeScopedPermissionPattern.test(code);
}

function dynamicPermissionDescription(code: string) {
  const match = code.match(nodeScopedPermissionPattern);
  if (!match) {
    return undefined;
  }

  const action = match[1];
  const nodeId = match[2];
  return action === "read"
    ? `Read access for node ${nodeId}`
    : `Write access for node ${nodeId}`;
}

async function resolvePermissionIds(permissionCodes: string[]) {
  let permissions = await RoleStore.listPermissions();
  let permissionByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));

  const missingCodes = permissionCodes.filter((code) => !permissionByCode.has(code));
  const unsupportedCodes = missingCodes.filter((code) => !isSupportedDynamicPermissionCode(code));
  if (unsupportedCodes.length > 0) {
    return {
      error: { message: `unknown permissions: ${unsupportedCodes.join(", ")}` },
      permissionIds: null,
    };
  }

  for (const code of missingCodes) {
    await RoleStore.ensurePermission(code, dynamicPermissionDescription(code));
  }

  if (missingCodes.length > 0) {
    permissions = await RoleStore.listPermissions();
    permissionByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));
  }

  return {
    error: null,
    permissionIds: permissionCodes.map((code) => permissionByCode.get(code) as string),
  };
}

async function requireAdminSession(rawAuthorization?: string) {
  const bearerToken = readBearerToken(rawAuthorization);
  if (!bearerToken) {
    return { session: null, error: { status: 401, body: { error: "missing bearer token" } } };
  }

  const tokenHash = await Passwords.hashToken(bearerToken);
  const session = await SessionStore.findActiveSessionByTokenHash(tokenHash);
  if (!session) {
    return { session: null, error: { status: 401, body: { error: "invalid session" } } };
  }

  const isAdmin = session.user.roles.some((entry) => entry.role.name === "admin");
  if (!isAdmin) {
    return { session: null, error: { status: 403, body: { error: "admin role required" } } };
  }

  return { session, error: null };
}

function listEffectivePermissionCodes(session: NonNullable<Awaited<ReturnType<typeof SessionStore.findActiveSessionByTokenHash>>>) {
  const permissions = new Set<string>();
  for (const userRole of session.user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.code);
    }
  }

  return [...permissions].sort((a, b) => a.localeCompare(b));
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
      permissions: listEffectivePermissionCodes(session),
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
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
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

  app.get("/auth/users", async (request, reply) => {
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const users = await UserStore.listUsersWithRoles();
    return { users };
  });

  app.get("/auth/roles", async (request, reply) => {
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const roles = await RoleStore.listRolesWithPermissions();
    return { roles };
  });

  app.get("/auth/permissions", async (request, reply) => {
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const permissions = await RoleStore.listPermissions();
    return { permissions };
  });

  app.post("/auth/users/:userId/roles", async (request, reply) => {
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const userId = (request.params as { userId?: string } | undefined)?.userId;
    if (!userId) {
      return reply.status(400).send({ error: "userId is required" });
    }

    const body = request.body as { roleNames?: unknown } | undefined;
    const roleNames = parseStringArray(body?.roleNames);
    if (!roleNames || roleNames.length === 0) {
      return reply.status(400).send({ error: "at least one role is required" });
    }

    const user = await UserStore.findById(userId);
    if (!user) {
      return reply.status(404).send({ error: "user not found" });
    }

    const roles = await RoleStore.findRolesByNames(roleNames);
    if (roles.length !== roleNames.length) {
      const missing = roleNames.filter((name) => !roles.some((role) => role.name === name));
      return reply.status(400).send({ error: `unknown roles: ${missing.join(", ")}` });
    }

    const nextRoleNames = new Set(roleNames);
    const isRemovingAdmin = user.roles.some((entry) => entry.role.name === "admin") && !nextRoleNames.has("admin");
    if (isRemovingAdmin) {
      const hasOtherCredentialedAdmin = await UserStore.hasCredentialedAdminExcludingEmail(user.emailNormalized);
      if (!hasOtherCredentialedAdmin) {
        return reply.status(400).send({ error: "cannot remove the last credentialed admin" });
      }
    }

    await RoleStore.replaceUserRoles(
      user.id,
      roles.map((role) => role.id)
    );

    const updatedUser = await UserStore.findById(user.id);
    return {
      user: {
        id: updatedUser?.id ?? user.id,
        email: updatedUser?.email ?? user.email,
        roles: (updatedUser?.roles ?? user.roles).map((entry) => entry.role.name),
      },
    };
  });

  app.post("/auth/roles", async (request, reply) => {
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const body = request.body as { name?: unknown; description?: unknown; permissionCodes?: unknown } | undefined;
    const roleName = parseRoleName(body?.name);
    if (!roleName) {
      return reply.status(400).send({ error: "valid role name is required" });
    }

    const description = typeof body?.description === "string" ? body.description.trim() : undefined;
    const role = await RoleStore.ensureRole(roleName, description);

    if (body?.permissionCodes !== undefined) {
      const permissionCodes = parseStringArray(body.permissionCodes);
      if (!permissionCodes) {
        return reply.status(400).send({ error: "permissionCodes must be an array of strings" });
      }

      const resolvedPermissions = await resolvePermissionIds(permissionCodes);
      if (resolvedPermissions.error) {
        return reply.status(400).send({ error: resolvedPermissions.error.message });
      }

      await RoleStore.replaceRolePermissions(role.id, resolvedPermissions.permissionIds);
    }

    const roles = await RoleStore.listRolesWithPermissions();
    return {
      role: roles.find((entry) => entry.name === role.name) ?? {
        id: role.id,
        name: role.name,
        description: role.description,
        usersCount: 0,
        permissions: [],
      },
    };
  });

  app.post("/auth/roles/:roleName/permissions", async (request, reply) => {
    const authResult = await requireAdminSession(request.headers.authorization);
    if (authResult.error) {
      return reply.status(authResult.error.status).send(authResult.error.body);
    }

    const roleName = parseRoleName((request.params as { roleName?: unknown } | undefined)?.roleName);
    if (!roleName) {
      return reply.status(400).send({ error: "valid roleName is required" });
    }

    const body = request.body as { permissionCodes?: unknown } | undefined;
    const permissionCodes = parseStringArray(body?.permissionCodes);
    if (!permissionCodes) {
      return reply.status(400).send({ error: "permissionCodes must be an array of strings" });
    }

    const roles = await RoleStore.findRolesByNames([roleName]);
    const role = roles[0];
    if (!role) {
      return reply.status(404).send({ error: "role not found" });
    }

    const resolvedPermissions = await resolvePermissionIds(permissionCodes);
    if (resolvedPermissions.error) {
      return reply.status(400).send({ error: resolvedPermissions.error.message });
    }

    await RoleStore.replaceRolePermissions(role.id, resolvedPermissions.permissionIds);

    const refreshedRoles = await RoleStore.listRolesWithPermissions();
    return {
      role: refreshedRoles.find((entry) => entry.name === role.name) ?? null,
    };
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
