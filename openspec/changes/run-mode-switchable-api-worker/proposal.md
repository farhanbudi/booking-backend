## Why

Render tier gratis hanya mengizinkan satu Web Service (satu proses), sehingga API server (Elysia) dan BullMQ worker harus berjalan dalam satu proses Bun. Namun, kode tidak boleh "disatukan" tanpa struktur — pemisahan modul yang jelas diperlukan agar nanti bisa dipisah menjadi 2 service (server + worker terpisah) tanpa refactor besar.

## What Changes

- **BREAKING**: `src/index.ts` tidak lagi auto-jalan sebagai server saat di-import; diganti menjadi entry point yang membaca env var `RUN_MODE` dan menentukan apa yang dijalankan
- **BREAKING**: `src/worker.ts` tidak lagi auto-jalan saat di-import; logika worker dibungkus dalam fungsi `startWorker()` yang harus dipanggil eksplisit
- **NEW**: `src/queue.ts` — hanya definisi Queue BullMQ + koneksi Redis (logika koneksi dipindahkan dari `src/jobs/queues.ts`)
- **RESTRUCTURE**: `src/worker.ts` — logic `new Worker(...)` dan processor dibungkus dalam `startWorker()`; impor koneksi dari `queue.ts`, bukan buat baru
- **NEW**: `src/server.ts` — setup Elysia app + semua route dibungkus dalam `startServer()`; impor route modules yang sudah ada
- **RESTRUCTURE**: `src/index.ts` (versi baru) — satu-satunya entry point yang baca `RUN_MODE` dan memutuskan server/worker/api yang dijalankan
- **MODIFIED**: `package.json` — tambah script `dev:api` dan `dev:worker`; update `worker` script agar pakai `RUN_MODE=worker`
- **MODIFIED**: `.env.example` — tambah `RUN_MODE=all`
- **MODIFIED**: `README.md` — tambah section tentang RUN_MODE dan cara deploy
- **MODIFIED**: `src/run-test-server.ts` — perlu panggil `startServer()` secara eksplisit karena `index.ts` tidak auto-start lagi

## Capabilities

(empty — ini pure refactor, tidak ada perubahan behavior eksternal)

## Impact

- Entry point `src/index.ts` berubah perilaku: sekarang membaca env var `RUN_MODE` (default `"all"`)
- `src/worker.ts` berubah dari standalone entry point menjadi module dengan fungsi `startWorker()` — tidak boleh auto-jalan saat di-import
- `src/server.ts` baru — setup Elysia dipisah dari `index.ts`; semua route modules tetap di tempatnya
- `src/jobs/queues.ts` — logika koneksi Redis dan Queue dipindahkan ke `src/queue.ts` (file baru); file lama bisa dihapus setelah migrasi
- `src/run-test-server.ts` perlu update karena `await import("./index")` tidak akan auto-start server lagi
- Default `RUN_MODE` (kalau env var tidak di-set) HARUS `"all"` — perilaku deploy saat ini tidak boleh berubah
