// Jalankan dengan: bun run test:server
// Menyalakan server backend khusus untuk test e2e frontend, memakai konfigurasi
// dari file `.env.test` (bukan `.env`). Alur:
//   1. Muat `.env.test` dan pastikan DATABASE_URL mengarah ke database test.
//   2. Reset + siapkan database test (buat jika belum ada, migrate, exclusion
//      constraint) supaya state e2e selalu deterministik.
//   3. Seed data awal (4 resource + 1 akun admin).
//   4. Start server (port mengikuti `.env.test`, default 3001).

import { loadTestEnvFile, assertTestDatabaseUrl } from "./utils/test-env";
import { resetTestDatabase } from "./db/prepare-test-db";
import { seedDatabase } from "./db/seed";
import { startServer } from "./index";

loadTestEnvFile();
assertTestDatabaseUrl();

await resetTestDatabase();
await seedDatabase();

startServer();