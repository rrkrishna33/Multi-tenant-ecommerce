import type { Config } from "drizzle-kit";
import { envOr } from "./src/lib/env";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: envOr("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/crackers"),
  },
} satisfies Config;
