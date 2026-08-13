// Helper untuk siklus hidup database test: migrate + exclusion constraint idempoten,
// reset state antar test, dan menutup koneksi. Semua operasi berjalan pada koneksi
// yang sama dengan modul app (dikirim lewat DATABASE_URL oleh tests/setup.ts).

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "../../src/db/client";

// Buat database test dulu kalau belum ada (dokumentasi: `bun run db:create:test`).
export async function createTestDatabase() {
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

function urlToOptions(url: URL): postgres.Options<{}> {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    pass: decodeURIComponent(url.password),
  };
}

// Jalankan migrate + pastikan exclusion constraint ada (idempoten).
// Wajib dipanggil sekali sebelum test yang butuh database.
export async function prepareDatabase() {
  await createTestDatabase();

  // Kalau database baru dibuat, migrate juga perlu menjalankan ekstensi.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS btree_gist`);

  await migrate(db, { migrationsFolder: "./src/db/migrations" });

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

// Reset semua tabel ke keadaan kosong + id kembali dari awal supaya tiap test
// deterministik dan independen. Dipanggil di beforeAll/beforeEach tiap file test.
export async function resetDb() {
  await prepareDatabase();
  await db.execute(
    sql`TRUNCATE TABLE bookings, resources, users RESTART IDENTITY CASCADE`
  );
}

export async function closeDb() {
  await client.end();
}