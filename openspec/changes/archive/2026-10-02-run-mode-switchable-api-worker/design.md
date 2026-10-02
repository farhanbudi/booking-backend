## Context

Saat ini, instance Elysia (server), `new Worker(...)` (BullMQ), dan koneksi Redis/Queue semuanya tercampur di `src/index.ts` dan `src/worker.ts`. Deploy ke Render tier gratis memaksa satu proses, tapi kode perlu terpisah secara modul untuk memudahkan pemisahan nanti.

- `src/index.ts`: Elysia app + `.listen()` — entry point server saat ini
- `src/worker.ts`: `new Worker(...)` + graceful shutdown — entry point worker saat ini
- `src/jobs/queues.ts`: `getBookingEmailQueue()` — singleton Queue + koneksi ioredis
- `src/run-test-server.ts`: dynamic import `./index` untuk menjalankan server e2e

## Goals / Non-Goals

**Goals:**
- Pisahkan tanggung jawab: queue config, worker logic, server setup, dan entry point
- Semua modul independen — tidak auto-jalan saat di-import
- Satu entry point (`index.ts`) yang memutuskan mode lewat `RUN_MODE`
- Default `RUN_MODE="all"` sehingga deploy saat ini tidak berubah perilaku
- Mempertahankan semua logic bisnis, queue nama, dan error handling yang sudah ada

**Non-Goals:**
- Mengubah logika pemrosesan job di worker
- Mengubah rute API atau middleware
- Mengubah nama queue BullMQ
- Menambahkan fitur baru

## Decisions

### Q1: Bagaimana memisahkan server dan worker?

**Keputusan**: Masing-masing dibungkus dalam fungsi (`startServer()`, `startWorker()`) yang tidak auto-jalan saat di-import. `index.ts` memanggil keduanya berdasarkan `RUN_MODE`.

**Alternatif dipertimbangkan**: Membuat 2 file entry point (`server-entry.ts` dan `worker-entry.ts`). Ini mengharuskan duplikasi import dan tidak sesuai dengan konsep "satu codebase, bisa dijalankan sebagai gabungan atau terpisah".

### Q2: Di mana menaruh Queue dan koneksi Redis?

**Keputusan**: `src/queue.ts` — hanya `redisConnection` (IORedis) dan `Queue` instance(s). Tanpa `Worker`, tanpa `startServer`, tanpa auto-run.

**Alternatif**: Mempertahankan `src/jobs/queues.ts`. Tetapi karena `queue.ts` harus menjadi satu-satunya tempat definisi Queue, dan file tersebut sudah ada di lokasi berbeda, lebih jelas untuk menjadikannya `queue.ts` sesuai spec.

### Q3: Bagaimana dengan `run-test-server.ts` yang meng-import `index.ts`?

**Keputusan**: Update `run-test-server.ts` untuk memanggil `startServer()` secara eksplisit setelah `await import("./index")`, bukan mengandalkan auto-start.

### Q4: Graceful shutdown untuk worker?

**Keputusan**: Sertakan — pindahkan SIGTERM/SIGINT handler dari `worker.ts` ke `index.ts` agar berjalan terlepas dari RUN_MODE. `startWorker()` mengembalikan instance worker; `index.ts` menangkap `worker.close()` pada SIGTERM.

### Q5: Apakah `src/jobs/queues.ts` dihapus?

**Keputusan**: Tidak dihapus saat refactor (agar perubahan bertahap aman). Dalam tugas implementasi, logika koneksi dipindahkan ke `queue.ts` dan `src/jobs/queues.ts` bisa dihapus setelah semua import dialihkan.

## Risks / Trade-offs

- [Risk] `run-test-server.ts` dan test lain yang secara dinamis meng-import `index.ts` mungkin bergantung pada auto-start → Mitigasi: update `run-test-server.ts` untuk memanggil `startServer()` eksplisit; pastikan tidak ada test yang bergantung pada auto-start.
- [Risk] Bun `--watch` (dev mode) dengan `index.ts` sebagai entry point akan me-restart kedua server dan worker saat file berubah → Mitigasi: perilaku ini sudah ada sebelumnya (`bun run dev` menjalankan server); `RUN_MODE=all` mempertahankan perilaku yang sama.
- [Trade-off] `startWorker()` mengembalikan instance `Worker` BullMQ — ini diperlukan agar `index.ts` bisa menangani graceful shutdown, tetapi mengekspos detail internal worker ke entry point.
