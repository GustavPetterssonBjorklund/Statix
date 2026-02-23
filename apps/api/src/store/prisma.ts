import { Prisma, TokenType } from "@prisma/client";
import { ulid } from "ulid";
import { SystemInfoSchema, type MetricsPayload, type SystemInfoPayload } from "@statix/shared";

import { prisma } from "../lib/prisma.js";
import { markNodesChanged } from "../realtime/nodes.js";

export async function dbHealthcheck() {
  await prisma.$queryRaw`SELECT 1`;
}

export async function listNodes() {
  const nodes = await prisma.node.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      metrics: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          createdAt: true,
          ts: true,
          cpu: true,
          memUsed: true,
          memTotal: true,
          diskUsed: true,
          diskTotal: true,
          netRx: true,
          netTx: true,
        },
      },
      _count: {
        select: { metrics: true },
      },
      systemInfo: {
        select: {
          hash: true,
          payload: true,
          reportedTs: true,
          updatedAt: true,
        },
      },
    },
  });

  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    lastSeenAt: node.lastSeenAt,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    publishCount: node._count.metrics,
    lastPublishAt: node.metrics[0]?.createdAt ?? null,
    latestMetric: node.metrics[0]
      ? {
          at: node.metrics[0].createdAt,
          ts: Number(node.metrics[0].ts),
          cpu: node.metrics[0].cpu,
          memUsed: Number(node.metrics[0].memUsed),
          memTotal: Number(node.metrics[0].memTotal),
          diskUsed: Number(node.metrics[0].diskUsed),
          diskTotal: Number(node.metrics[0].diskTotal),
          netRx: Number(node.metrics[0].netRx),
          netTx: Number(node.metrics[0].netTx),
        }
      : null,
    systemInfo: node.systemInfo
      ? (() => {
          const parsed = SystemInfoSchema.safeParse(node.systemInfo.payload);
          return {
            hash: node.systemInfo.hash,
            reportedTs: Number(node.systemInfo.reportedTs),
            updatedAt: node.systemInfo.updatedAt,
            info: parsed.success ? parsed.data.info : null,
          };
        })()
      : null,
  }));
}

export async function createNode(changeset: { name?: string; authTokenHash: string }) {
  return prisma.node.create({
    data: {
      id: ulid(),
      name: changeset.name ?? null,
      authTokenHash: changeset.authTokenHash,
    },
  });
}

export namespace NodeStore {
  export async function findById(nodeId: string) {
    return prisma.node.findUnique({
      where: { id: nodeId },
    });
  }

  export async function rotateMqttCredentials(changeset: {
    nodeId: string;
    username: string;
    passwordHash: string;
    passwordExpiresAt: Date;
  }) {
    return prisma.node.update({
      where: { id: changeset.nodeId },
      data: {
        mqttUsername: changeset.username,
        mqttPasswordHash: changeset.passwordHash,
        mqttPasswordExpiresAt: changeset.passwordExpiresAt,
      },
      select: {
        id: true,
        mqttUsername: true,
        mqttPasswordExpiresAt: true,
      },
    });
  }

  export async function touchLastSeen(nodeId: string, at: Date) {
    return prisma.node.update({
      where: { id: nodeId },
      data: {
        lastSeenAt: at,
      },
      select: { id: true },
    });
  }
}

function toBigInt(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return BigInt(0);
  }
  return BigInt(Math.trunc(value));
}

export namespace MetricStore {
  export async function appendNodeMetric(nodeId: string, payload: MetricsPayload) {
    const tsValue = toBigInt(payload.ts);
    const observedAt = new Date(Number(tsValue));

    const result = await prisma.$transaction([
      prisma.metric.create({
        data: {
          nodeId,
          ts: tsValue,
          cpu: payload.cpu,
          memUsed: toBigInt(payload.mem_used),
          memTotal: toBigInt(payload.mem_total),
          diskUsed: toBigInt(payload.disk_used),
          diskTotal: toBigInt(payload.disk_total),
          netRx: toBigInt(payload.net_rx),
          netTx: toBigInt(payload.net_tx),
        },
      }),
      prisma.node.update({
        where: { id: nodeId },
        data: {
          lastSeenAt: observedAt,
        },
      }),
    ]);

    markNodesChanged();
    return result;
  }

  export async function listRecentByNode(nodeId: string, limit = 60) {
    const safeLimit = Math.max(1, Math.min(300, Math.trunc(limit)));
    const rows = await prisma.metric.findMany({
      where: { nodeId },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        createdAt: true,
        ts: true,
        cpu: true,
        memUsed: true,
        memTotal: true,
        diskUsed: true,
        diskTotal: true,
        netRx: true,
        netTx: true,
      },
    });

    return rows
      .reverse()
      .map((row) => ({
        at: row.createdAt,
        ts: Number(row.ts),
        cpu: row.cpu,
        memUsed: Number(row.memUsed),
        memTotal: Number(row.memTotal),
        diskUsed: Number(row.diskUsed),
        diskTotal: Number(row.diskTotal),
        netRx: Number(row.netRx),
        netTx: Number(row.netTx),
      }));
  }
}

export namespace SystemInfoStore {
  export async function upsertNodeSystemInfo(nodeId: string, payload: SystemInfoPayload) {
    const tsValue = toBigInt(payload.ts);
    const observedAt = new Date(Number(tsValue));

    const existing = await prisma.nodeSystemInfo.findUnique({
      where: { nodeId },
      select: { hash: true },
    });

    if (existing?.hash === payload.hash) {
      await prisma.node.update({
        where: { id: nodeId },
        data: {
          lastSeenAt: observedAt,
        },
      });
      return { changed: false };
    }

    await prisma.$transaction([
      prisma.nodeSystemInfo.upsert({
        where: { nodeId },
        update: {
          hash: payload.hash,
          payload: payload as unknown as Prisma.InputJsonObject,
          reportedTs: tsValue,
        },
        create: {
          nodeId,
          hash: payload.hash,
          payload: payload as unknown as Prisma.InputJsonObject,
          reportedTs: tsValue,
        },
      }),
      prisma.node.update({
        where: { id: nodeId },
        data: {
          lastSeenAt: observedAt,
        },
      }),
    ]);

    markNodesChanged();
    return { changed: true };
  }
}

export namespace UserStore {
  export async function hasCredentialedAdmin() {
    const adminUser = await prisma.user.findFirst({
      where: {
        passwordHash: { not: null },
        roles: {
          some: {
            role: {
              name: "admin",
            },
          },
        },
      },
      select: { id: true },
    });

    return adminUser !== null;
  }

  export async function hasCredentialedAdminExcludingEmail(emailNormalized: string) {
    const adminUser = await prisma.user.findFirst({
      where: {
        emailNormalized: { not: emailNormalized },
        passwordHash: { not: null },
        roles: {
          some: {
            role: {
              name: "admin",
            },
          },
        },
      },
      select: { id: true },
    });

    return adminUser !== null;
  }

  export async function countUsers() {
    return prisma.user.count();
  }

  export async function findByEmail(emailNormalized: string) {
    return prisma.user.findUnique({
      where: { emailNormalized },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  export async function findById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  export async function createShellUser(changeset: {
    email: string;
    displayName?: string;
  }) {
    const emailNormalized = changeset.email.trim().toLowerCase();
    return prisma.user.create({
      data: {
        email: changeset.email.trim(),
        emailNormalized,
        displayName: changeset.displayName?.trim() || null,
      },
    });
  }

  export async function createWithPassword(changeset: {
    email: string;
    passwordHash: string;
    displayName?: string;
    verified?: boolean;
  }) {
    const emailNormalized = changeset.email.trim().toLowerCase();
    return prisma.user.create({
      data: {
        email: changeset.email.trim(),
        emailNormalized,
        passwordHash: changeset.passwordHash,
        emailVerifiedAt: changeset.verified ? new Date() : null,
        displayName: changeset.displayName?.trim() || null,
      },
    });
  }

  export async function updatePassword(userId: string, passwordHash: string) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        emailVerifiedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  export async function updateProfileAndPassword(changeset: {
    userId: string;
    email: string;
    passwordHash: string;
    displayName?: string;
  }) {
    const email = changeset.email.trim();
    const emailNormalized = email.toLowerCase();

    return prisma.user.update({
      where: { id: changeset.userId },
      data: {
        email,
        emailNormalized,
        passwordHash: changeset.passwordHash,
        emailVerifiedAt: new Date(),
        displayName: changeset.displayName?.trim() || null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  export async function recordLoginFailure(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: {
          increment: 1,
        },
      },
    });
  }

  export async function recordLoginSuccess(userId: string, ip?: string) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip ?? null,
      },
    });
  }

  export async function deleteById(userId: string) {
    return prisma.user.delete({
      where: { id: userId },
    });
  }
}

export namespace RoleStore {
  export async function ensureRole(name: string, description?: string) {
    return prisma.role.upsert({
      where: { name },
      update: {
        description: description ?? null,
      },
      create: {
        name,
        description: description ?? null,
      },
    });
  }

  export async function assignRole(userId: string, roleId: string) {
    return prisma.userRole.upsert({
      where: {
        userId_roleId: { userId, roleId },
      },
      update: {},
      create: { userId, roleId },
    });
  }
}

export namespace AuthTokenStore {
  export async function createResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.authToken.create({
      data: {
        userId,
        type: TokenType.RESET_PASSWORD,
        tokenHash,
        expiresAt,
      },
    });
  }

  export async function rotateResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    await prisma.authToken.deleteMany({
      where: {
        userId,
        type: TokenType.RESET_PASSWORD,
        consumedAt: null,
      },
    });

    return createResetToken(userId, tokenHash, expiresAt);
  }

  export async function rotateResetTokenWithMetadata(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    metadata: Record<string, unknown>
  ) {
    await prisma.authToken.deleteMany({
      where: {
        userId,
        type: TokenType.RESET_PASSWORD,
        consumedAt: null,
      },
    });

    return prisma.authToken.create({
      data: {
        userId,
        type: TokenType.RESET_PASSWORD,
        tokenHash,
        expiresAt,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  export async function findActiveResetTokenByUser(userId: string) {
    return prisma.authToken.findFirst({
      where: {
        userId,
        type: TokenType.RESET_PASSWORD,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  export async function findUsableResetToken(tokenHash: string) {
    return prisma.authToken.findFirst({
      where: {
        tokenHash,
        type: TokenType.RESET_PASSWORD,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });
  }

  export async function consumeToken(tokenId: string) {
    return prisma.authToken.update({
      where: { id: tokenId },
      data: { consumedAt: new Date() },
    });
  }
}

export namespace SessionStore {
  export async function createSession(changeset: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }) {
    return prisma.session.create({
      data: {
        userId: changeset.userId,
        tokenHash: changeset.tokenHash,
        expiresAt: changeset.expiresAt,
        ip: changeset.ip ?? null,
        userAgent: changeset.userAgent ?? null,
      },
    });
  }

  export async function findActiveSessionByTokenHash(tokenHash: string) {
    return prisma.session.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });
  }

  export async function touchSession(sessionId: string) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  export async function revokeByTokenHash(tokenHash: string) {
    return prisma.session.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
