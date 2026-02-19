import { PrismaClient } from "@prisma/client";
import { seedPermissionsAndRoles } from "./seed-perms.ts";

const prisma = new PrismaClient();

type SeedStage = {
  name: string;
  run: () => Promise<void>;
};

async function main() {
  const stages: SeedStage[] = [
    {
      name: "roles-permissions",
      run: async () => seedPermissionsAndRoles(prisma),
    },
  ];

  let failedStages = 0;

  for (const stage of stages) {
    const startedAt = Date.now();
    process.stdout.write(`[seed] ${stage.name}... `);

    try {
      await stage.run();
      const elapsedMs = Date.now() - startedAt;
      console.log(`ok (${elapsedMs}ms)`);
    } catch (error) {
      failedStages += 1;
      console.log("failed");
      console.error(`[seed] ${stage.name} error:`, error);
    }
  }

  if (failedStages > 0) {
    throw new Error(`Seed failed: ${failedStages} stage(s) failed`);
  }

  console.log(`[seed] complete (${stages.length} stage(s))`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
