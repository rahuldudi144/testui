import bcrypt from "bcryptjs";
import { prisma } from "../server/db.js";

const SEED_USERNAME = "rahul@test.com";
const SEED_PASSWORD = "1234";

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  await prisma.user.upsert({
    where: { username: SEED_USERNAME },
    update: { passwordHash },
    create: {
      username: SEED_USERNAME,
      passwordHash,
    },
  });

  console.log(`Seeded user: ${SEED_USERNAME}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
