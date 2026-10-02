## 1. Persiapan & Analisis

- [x] 1.1 Laporkan lokasi asli Queue (`src/jobs/queues.ts`), Worker (`src/worker.ts`), dan Elysia app (`src/index.ts`) — verifikasi temuan sebelum menulis kode
- [x] 1.2 Periksa semua import yang bergantung pada `src/worker.ts` dan `src/index.ts` (termasuk `src/run-test-server.ts` dan test files) untuk memahami dampak perubahan
- [x] 1.3 Verifikasi nama queue yang digunakan (`QUEUE_NAME` dari `src/jobs/types.ts`) — pastikan TIDAK berubah

## 2. Buat `src/queue.ts`

- [x] 2.1 Buat `src/queue.ts` berisi: `redisConnection` (IORedis dari `REDIS_URL`, `maxRetriesPerRequest: null`) dan Queue instance(s) sesuai nama yang sudah ada di project (yaitu `"booking-emails"`)
- [x] 2.2 Pastikan `src/queue.ts` TIDAK mengandung `new Worker(...)`, `startServer()`, atau auto-run apapun
- [x] 2.3 Verifikasi: file hanya berisi koneksi Redis dan Queue definition

## 3. Buat/Restrukturisasi `src/worker.ts`

- [x] 3.1 Pindahkan `new Worker(...)` dan logika processor dari `src/worker.ts` lama ke `startWorker()` di `src/worker.ts` yang baru
- [x] 3.2 Import koneksi dari `./queue` (`redisConnection`), JANGAN buat koneksi baru
- [x] 3.3 Pastikan `startWorker()` mengembalikan instance worker (untuk graceful shutdown)
- [x] 3.4 Pastikan `src/worker.ts` TIDAK auto-jalan saat di-import (hapus `validateEnv()`, `worker.on(...)`, dan `console.log` di level module — pindahkan ke dalam `startWorker()`)
- [x] 3.5 Verifikasi: import `src/worker.ts` tidak memicu pembuatan worker

## 4. Buat `src/server.ts`

- [x] 4.1 Buat `src/server.ts` berisi: `new Elysia()` + semua `.use(...)` route (authRoutes, resourceRoutes, bookingRoutes, paymentRoutes), error handler, cors, openapi — sama persis dengan `src/index.ts` lama
- [x] 4.2 Bungkus dalam `startServer()` yang memanggil `.listen(process.env.PORT ?? 3000)` dan mengembalikan app instance
- [x] 4.3 Pastikan `src/server.ts` TIDAK auto-jalan saat di-import
- [x] 4.4 Import route modules dan middleware yang sudah ada (JANGAN pindahkan file-file tersebut)
- [x] 4.5 Verifikasi: import `src/server.ts` tidak memulai server

## 5. Tulis ulang `src/index.ts` sebagai entry point

- [x] 5.1 Buat `src/index.ts` baru yang membaca `RUN_MODE` dari env var (default `"all"`)
- [x] 5.2 Implementasikan switch: `api` → `startServer()`; `worker` → `startWorker()`; `all` → keduanya; default → fallback ke `all`
- [x] 5.3 Import `startServer` dari `./server` dan `startWorker` dari `./worker`
- [x] 5.4 Tambahkan graceful shutdown (SIGTERM/SIGINT) yang menutup worker dan koneksi sebelum exit
- [x] 5.5 Verifikasi: `bun run src/index.ts` (tanpa RUN_MODE) menjalankan server + worker seperti sebelumnya

## 6. Update `package.json`

- [x] 6.1 Tambahkan script `"dev:api": "RUN_MODE=api bun run --watch src/index.ts"`
- [x] 6.2 Tambahkan script `"dev:worker": "RUN_MODE=worker bun run --watch src/index.ts"`
- [x] 6.3 Update script `"worker"` agar menghasilkan worker: ubah ke `RUN_MODE=worker bun run src/index.ts` (karena `src/worker.ts` tidak auto-jalan lagi)
- [x] 6.4 Pastikan script `dev` dan `start` tetap tidak berubah (default `RUN_MODE=all`)
- [x] 6.5 Verifikasi: `bun run dev` tetap menjalankan server + worker; `bun run dev:api` hanya server; `bun run dev:worker` hanya worker

## 7. Update `.env.example`

- [x] 7.1 Tambahkan `RUN_MODE=all` (dengan komentar penjelasan) ke `.env.example`
- [x] 7.2 Verifikasi: `.env.example` berisi RUN_MODE

## 8. Update `README.md`

- [x] 8.1 Tambahkan section tentang RUN_MODE: cara deploy 1 service (default) dan cara pisah 2 service
- [x] 8.2 Update section "Instalasi" jika perlu (misal: tidak perlu lagi menjalankan 2 proses terpisah di local)
- [x] 8.3 Verifikasi: README mencerminkan mekanisme RUN_MODE

## 9. Update `src/run-test-server.ts`

- [x] 9.1 Ubah `await import("./index")` menjadi memanggil `startServer()` secara eksplisit (import `startServer` dari `./index` lalu panggil)
- [x] 9.2 Verifikasi: `bun run test:server` tetap berjalan dan server e2e tetap jalan di port yang benar

## 10. Verifikasi Menyeluruh

- [x] 10.1 `bun run dev` (default tanpa RUN_MODE): server + worker jalan bareng, semua endpoint HTTP merespons, worker memproses job
- [x] 10.2 `bun run dev:api`: hanya server HTTP yang jalan, endpoint merespons, worker TIDAK memproses job (uji dengan enqueue job manual)
- [x] 10.3 `bun run dev:worker`: hanya worker yang jalan, HTTP endpoint TIDAK bisa diakses
- [x] 10.4 `bun run test`: semua test tetap lolos (test tidak bergantung pada RUN_MODE atau auto-start)
- [x] 10.5 `bun run test:server`: server e2e tetap jalan di port 3001
- [x] 10.6 `bun run start`: server + worker jalan (default RUN_MODE=all)
- [x] 10.7 Typing check: `bunx tsc --noEmit` tidak ada error ✓ (passed: 0 errors)
