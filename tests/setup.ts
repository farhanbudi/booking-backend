// Preload (di-load sebelum setiap file test oleh `--preload` di script `test`).
// Memuat variabel environment dari `.env.test` (bukan `.env`) SEBELUM modul app
// (db/client.ts, auth.middleware.ts) ikut ter-load, supaya test memakai database
// test khusus dan tidak menyentuh database development.
//
// Bun otomatis memuat `.env.test` saat `bun test` (karena NODE_ENV=test), tapi
// pemuatan eksplisit di sini membuat test tetap aman walau dijalankan di luar
// `bun test` dan menjamin `.env.test` selalu menimpa nilai dari `.env`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_ENV_FILE = resolve(import.meta.dir, "..", ".env.test");

function loadDotEnvFile(path: string) {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    throw new Error(`File environment testing tidak ditemukan: ${path}`);
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnvFile(TEST_ENV_FILE);

// Bun tidak menimpa variabel yang sudah ada di environment nyata (shell/IDE/CI)
// dengan nilai dari `.env`/`.env.test` (aturan first-wins). Karena itu preload
// (dipicu CLI `--preload` di script `test` DAN `[test].preload` di bunfig.toml)
// memuat `.env.test` secara eksplisit supaya test selalu memakai database test.
// Guard di bawah memastikan test tidak pernah diam-diam menimpa database dev.

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL tidak ditemukan di file .env.test");
}

const testDbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/test/i.test(testDbName)) {
  throw new Error(
    `DATABASE_URL di .env.test harus mengarah ke database test, tetapi ditemukan database "${testDbName}". Periksa file .env.test.`
  );
}