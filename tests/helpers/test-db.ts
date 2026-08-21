// Helper untuk siklus hidup database test: migrate + exclusion constraint idempoten,
// reset state antar test, dan menutup koneksi. Semua operasi berjalan pada koneksi
// yang sama dengan modul app (dikirim lewat DATABASE_URL oleh tests/setup.ts).
//
// Logika createTestDatabase + prepareDatabase + resetTestDatabase dipindah ke
// `src/db/prepare-test-db.ts` supaya bisa dipakai ulang oleh script
// `bun run test:server` (server khusus e2e) dan oleh helper test ini.

import { client } from "../../src/db/client";
import {
  createTestDatabase,
  prepareDatabase,
  resetTestDatabase,
} from "../../src/db/prepare-test-db";

export {
  createTestDatabase,
  prepareDatabase,
  resetTestDatabase as resetDb,
};

export async function closeDb(): Promise<void> {
  await client.end();
}