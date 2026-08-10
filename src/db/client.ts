import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL belum di-set di file .env");
}

export const client = postgres(connectionString);
export const db = drizzle(client, { schema });
