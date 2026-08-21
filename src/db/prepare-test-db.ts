// Helper bersama (dipakai src maupun tests) untuk menyiapkan database test:
// buat database kalau belum ada, jalankan migrate, pasang exclusion constraint
// `no_overlapping_bookings` (idempoten), dan reset isi tabel. Dipakai oleh
// `tests/helpers/test-db.ts` dan script `bun run test:server` (server untuk e2e).

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";
import { db } from "./client";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "migrations");

function urlToOptions(url: URL): postgres.Options<{}> {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    pass: decodeURIComponent(url.password),
  };
}

// Buat database test dulu kalau belum ada.
export async function createTestDatabase(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);

  const admin = postgres({ ...urlToOptions(url), database: "postgres" });
  try {
    const result = await admin.unsafe<{ found: boolean }[]>(
      "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS found",
      [dbName]
    );
    if (!result[0]?.found) {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
}

// Jalankan migrate + pastikan exclusion constraint ada (idempoten).
// Wajib dipanggil sekali sebelum proses apa pun yang butuh database test.
export async function prepareDatabase(): Promise<void> {
  await createTestDatabase();

  // Kalau database baru dibuat, migrate juga perlu menjalankan ekstensi.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS btree_gist`);

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Exclusion constraint manual (tidak ada di migrate Drizzle). PostgreSQL tidak
  // mendukung `ADD CONSTRAINT IF NOT EXISTS`, jadi dicek via pg_constraint dulu.
  const exists = await db.execute<{ found: boolean }>(sql`
    SELECT EXISTS(
      SELECT 1 FROM pg_constraint WHERE conname = 'no_overlapping_bookings'
    ) AS found
  `);
  if (!exists[0]?.found) {
    await db.execute(sql`
      ALTER TABLE bookings
        ADD CONSTRAINT no_overlapping_bookings
        EXCLUDE USING gist (
          resource_id WITH =,
          tstzrange(start_time, end_time) WITH &&
        )
        WHERE (status <> 'cancelled')
    `);
  }
}

// Reset semua tabel ke keadaan kosong + id kembali dari awal supaya state test
// deterministik dan independen.
export async function resetTestDatabase(): Promise<void> {
  await prepareDatabase();
  await db.execute(
    sql`TRUNCATE TABLE bookings, resources, users RESTART IDENTITY CASCADE`
  );
}