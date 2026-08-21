// Preload (di-load sebelum setiap file test oleh `--preload` di script `test`).
// Memuat variabel environment dari `.env.test` (bukan `.env`) SEBELUM modul app
// (db/client.ts, auth.middleware.ts) ikut ter-load, supaya test memakai database
// test khusus dan tidak menyentuh database development.
//
// Bun otomatis memuat `.env.test` saat `bun test` (karena NODE_ENV=test), tapi
// pemuatan eksplisit di sini membuat test tetap aman walau dijalankan di luar
// `bun test` dan menjamin `.env.test` selalu menimpa nilai dari `.env`.

import { loadTestEnvFile, assertTestDatabaseUrl } from "../src/utils/test-env";

loadTestEnvFile();
assertTestDatabaseUrl();