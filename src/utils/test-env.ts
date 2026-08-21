// Memuat `.env.test` secara eksplisit dan memastikan `DATABASE_URL` mengarah ke
// database test. Dipakai oleh `tests/setup.ts` (preload) dan script `test:server`
// supaya semua proses testing memakai konfigurasi yang sama dan tidak menyentuh
// database development.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_ENV_FILE = resolve(import.meta.dir, "..", "..", ".env.test");

// Parse isi file .env berformat KEY=VALUE sederhana (tanpa library dotenv).
function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

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

    result[key] = value;
  }

  return result;
}

// Muat file `.env.test` ke `process.env`, menimpa nilai yang sudah ada. Pemanggilan
// ini penting karena Bun tidak menimpa variabel environment nyata (shell/IDE/CI)
// dengan nilai dari `.env`/`.env.test` (aturan first-wins).
export function loadTestEnvFile(path: string = TEST_ENV_FILE): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    throw new Error(`File environment testing tidak ditemukan: ${path}`);
  }

  for (const [key, value] of Object.entries(parseDotEnv(content))) {
    process.env[key] = value;
  }
}

// Guard: pastikan `DATABASE_URL` ada dan mengarah ke database test, supaya test
// (atau server e2e) tidak pernah diam-diam memakai database development.
export function assertTestDatabaseUrl(
  url: string = process.env.DATABASE_URL ?? ""
): void {
  if (!url) {
    throw new Error("DATABASE_URL tidak ditemukan di file .env.test");
  }

  const testDbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(testDbName)) {
    throw new Error(
      `DATABASE_URL di .env.test harus mengarah ke database test, tetapi ditemukan database "${testDbName}". Periksa file .env.test.`
    );
  }
}