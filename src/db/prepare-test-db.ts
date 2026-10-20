// Helper bersama (dipakai src maupun tests) untuk menyiapkan database test:
// buat database kalau belum ada, jalankan migrate, pasang exclusion constraint
// `no_overlapping_bookings` (idempoten), dan reset isi tabel. Dipakai oleh
// `tests/helpers/test-db.ts` dan script `bun run test:server` (server untuk e2e).

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";
import { client, db } from "./client";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "migrations");

// Kunci advisory untuk menyerialisasi migrasi antar proses (mis. dua `bun test`
// bersamaan di database test yang sama). Nilainya bebas, yang penting konstan.
const MIGRATION_LOCK_ID = 728441001;

// Menyimpan promise migrasi yang sedang berjalan di `globalThis`, bukan di
// modul ini. Alasannya: `bun test` bisa memuat modul ini lebih dari sekali
// (preload `tests/setup.ts` dan import dari file test), dan dua instance itu
// akan menjalankan `migrate()` bersamaan -> bentrok "duplicate key value
// violates unique constraint pg_class_relname_nsp_index" saat membuat tabel
// `__drizzle_migrations`.
const PREPARE_KEY = "__bookingBackendPrepareDatabase";

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
//
// Aman dipanggil berulang kali dan dari banyak pemanggil sekaligus:
// - dalam satu proses, semua pemanggil menerima promise yang sama (lihat PREPARE_KEY);
// - antar proses, migrasi diserialisasi dengan advisory lock PostgreSQL.
export function prepareDatabase(): Promise<void> {
  const store = globalThis as unknown as Record<string, Promise<void> | undefined>;

  if (!store[PREPARE_KEY]) {
    store[PREPARE_KEY] = runPrepareDatabase().catch((error) => {
      // Jangan menyimpan kegagalan: pemanggilan berikutnya harus bisa mencoba lagi.
      delete store[PREPARE_KEY];
      throw error;
    });
  }

  return store[PREPARE_KEY];
}

async function runPrepareDatabase(): Promise<void> {
  await createTestDatabase();

  // Kunci advisory: session khusus (reserved) supaya lock dipegang koneksi
  // yang sama dari awal sampai akhir, dan dilepas di finally.
  const reserved = await client.reserve();
  try {
    await reserved`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;

    // Kalau database baru dibuat, migrate juga perlu menjalankan ekstensi.
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    // Guard eksplisit: kalau extension gagal dibuat (mis. postgresql-contrib
    // tidak terinstall), beri error yang jelas alih-alih gagal saat ADD CONSTRAINT.
    const ext = await db.execute<{ installed: boolean }>(sql`
      SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS installed
    `);
    if (!ext[0]?.installed) {
      throw new Error(
        "Gagal mengaktifkan extension 'btree_gist' yang dibutuhkan constraint " +
          "no_overlapping_bookings. Pastikan paket 'postgresql-contrib' terinstall " +
          "pada server PostgreSQL (mis. `apt install postgresql-contrib` / `brew install " +
          "postgresql` versi lengkap), lalu jalankan ulang."
      );
    }

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
  } finally {
    await reserved`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    reserved.release();
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