import { PrismaClient } from "@prisma/client";
import { seedPermissionsAndRoles } from "./seed-perms.ts";

const prisma = new PrismaClient();

async function main() {
  await seedPermissionsAndRoles(prisma);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
