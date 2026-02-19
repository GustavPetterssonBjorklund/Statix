import type { PrismaClient } from "@prisma/client";

const PERMISSIONS = [
  { code: "health:read", description: "Read service and database health" },
  { code: "nodes:read", description: "Read node data" },
  { code: "nodes:create", description: "Create nodes" },
  { code: "users:create", description: "Create allowed user accounts" },
  { code: "users:read", description: "Read user account metadata" },
  { code: "roles:assign", description: "Assign roles to users" },
  { code: "auth:me", description: "Read current authenticated identity" },
] as const;

const ROLE_DEFINITIONS = [
  {
    name: "admin",
    description: "Full administrative access",
    permissions: PERMISSIONS.map((permission) => permission.code),
  },
  {
    name: "user",
    description: "Default user access",
    permissions: ["health:read", "nodes:read", "auth:me"],
  },
] as const;

export async function seedPermissionsAndRoles(prisma: PrismaClient) {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description },
      create: {
        code: permission.code,
        description: permission.description,
      },
    });
  }

  const permissionByCode = new Map<string, string>();
  for (const permission of await prisma.permission.findMany({
    select: { id: true, code: true },
  })) {
    permissionByCode.set(permission.code, permission.id);
  }

  for (const roleDefinition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { name: roleDefinition.name },
      update: { description: roleDefinition.description },
      create: {
        name: roleDefinition.name,
        description: roleDefinition.description,
      },
    });

    for (const permissionCode of roleDefinition.permissions) {
      const permissionId = permissionByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(`Missing permission code: ${permissionCode}`);
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId,
        },
      });
    }
  }
}
