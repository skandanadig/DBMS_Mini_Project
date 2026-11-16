import { z } from "zod";
import { loadRootEnv } from "./load-root-env";

/**
 * Server configuration, read from environment variables only (never
 * hard-coded). The repo-root `.env` is loaded here, in the process that
 * serves requests (see lib/load-root-env.ts).
 * Validated lazily so `next build` works without a database.
 */
const EnvSchema = z.object({
  MYSQL_HOST: z.string().min(1).default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().int().positive().default(3307),
  MYSQL_USER: z.string().min(1, "MYSQL_USER is required"),
  MYSQL_PASSWORD: z.string().min(1, "MYSQL_PASSWORD is required"),
  MYSQL_DATABASE: z.string().min(1).default("skillmatch_db"),
  NEO4J_URI: z.string().min(1).default("bolt://127.0.0.1:7687"),
  NEO4J_USER: z.string().min(1).default("neo4j"),
  NEO4J_PASSWORD: z.string().min(8, "NEO4J_PASSWORD must be at least 8 characters"),
  JWT_SECRET: z
    .string()
    .min(
      32,
      "JWT_SECRET must be at least 32 characters. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    ),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    loadRootEnv();
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment configuration (check the repo-root .env):\n${lines.join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}
