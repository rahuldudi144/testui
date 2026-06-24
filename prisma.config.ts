import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun --env-file=.env prisma/seed.ts",
  },
  datasource: {
    url: env("TESTUI_DATABASE_URL"),
  },
});
