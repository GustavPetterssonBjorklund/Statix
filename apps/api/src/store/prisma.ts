import { Prisma, TokenType } from "@prisma/client";
import { ulid } from "ulid";

import { prisma } from "../lib/prisma.js";

export async function dbHealthcheck() {
  await prisma.$queryRaw`SELECT 1`;
}

export async function listNodes() {
  return prisma.node.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createNode(name: string) {
  return prisma.node.create({
    data: {
      id: ulid(),
      name,
    },
  });
}

export namespace UserStore {
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
