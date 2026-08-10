// Jalankan dengan: bun run db:migrate
// Script ini menjalankan migrasi drizzle-kit standar.
// Untuk exclusion constraint (manual_0001_exclusion_constraint.sql),
// jalankan terpisah lewat psql setelah migrasi ini selesai:
//
//   psql $DATABASE_URL -f src/db/migrations/manual_0001_exclusion_constraint.sql

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "./client";

await migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("✅ Migrasi drizzle selesai.");
console.log(
  "⚠️  Jangan lupa jalankan manual_0001_exclusion_constraint.sql secara manual via psql."
);
await client.end();
