## 1. Setup & Dependensi

- [x] 1.1 Install dependency baru: `bullmq`, `ioredis`, `nodemailer` (pin versi)
- [x] 1.2 Tambahkan env baru ke `.env.example`: `REDIS_URL` (default `redis://localhost:6379`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; catat cara menjalankan Redis lokal (`docker run -p 6379:6379 redis:7`) dan Mailpit di README
- [x] 1.3 Smoke test koneksi BullMQ + ioredis di runtime Bun (validasi kompatibilitas paling awal sebelum membangun sisanya)

## 2. Modul Mailer

- [x] 2.1 Buat `src/mailer/mailer.ts`: transport nodemailer dari `SMTP_HOST/PORT/USER/PASS`, pengirim `MAIL_FROM`, plus fungsi kirim email
- [x] 2.2 Buat `src/mailer/templates.ts`: template plain-text Bahasa Indonesia untuk konfirmasi, pembatalan, dan reminder (memuat nama resource serta waktu mulai/selesai booking) sebagai fungsi murni
- [x] 2.3 Unit test template (isi memuat resource + jadwal; format waktu konsisten) dengan `bun:test`

## 3. Queue & Producer

- [x] 3.1 Buat `src/jobs/queues.ts`: satu queue `booking-emails` dari `REDIS_URL` dengan job name `confirmation` | `cancellation` | `reminder`
- [x] 3.2 Buat producer helpers (payload minimal `{ bookingId }`): `enqueueConfirmation`, `enqueueCancellation`, `scheduleReminder` (delay = `startTime − 1 jam − now`, skip bila ≤ 0, `jobId: reminder-<bookingId>`), `removeReminder`
- [x] 3.3 Unit test util perhitungan delay reminder (booking > 1 jam → delay positif; booking last-minute < 1 jam → tidak dijadwalkan)

## 4. Processor & Worker

- [x] 4.1 Buat `src/jobs/processors.ts`: processor tiap job type me-re-fetch booking (join users + resources), memverifikasi status sesuai jenis job (`confirmed` untuk konfirmasi/reminder, `cancelled` untuk pembatalan) sebelum render template dan kirim via mailer
- [x] 4.2 Unit test processor dengan mailer & query di-mock: kirim sukses; booking sudah cancelled → skip tanpa error; booking tidak ditemukan → log dan lewati
- [x] 4.3 Buat `src/worker.ts`: jalankan Worker (`removeOnComplete` berumur pendek, `removeOnFail` menyimpan beberapa job gagal); retry `attempts: 3` + backoff eksponensial basis 2 detik dikonfigurasi per job di producer (BullMQ v6); event `failed` final → log; graceful shutdown `SIGINT`/`SIGTERM` → `worker.close()`; validasi env saat start (fail fast)
- [x] 4.4 Tambah script `"worker": "bun run src/worker.ts"` di `package.json`

## 5. Integrasi Service Booking

- [x] 5.1 `createBooking` di `bookings.service.ts`: setelah transaksi DB sukses, panggil `enqueueConfirmation` + `scheduleReminder` dalam try/catch — kegagalan hanya log warning, respons tetap 201
- [x] 5.2 `cancelBooking` di `bookings.service.ts`: setelah update sukses, panggil `enqueueCancellation` + `removeReminder` dengan pola try/catch yang sama
- [x] 5.3 Service test dengan producer yang di-mock: create memicu konfirmasi + reminder; cancel memicu pembatalan + penghapusan reminder; kegagalan queue tidak mengubah hasil API

## 6. Verifikasi Akhir

- [x] 6.1 `bunx tsc --noEmit` lolos (mencakup `src/**`)
- [x] 6.2 `bun test` hijau seluruhnya tanpa membutuhkan Redis/SMTP nyata
- [x] 6.3 Smoke test manual end-to-end (Redis lokal + SMTP sink sebagai pengganti Mailpit): buat booking → email konfirmasi terkirim dan job reminder terjadwal; cancel booking → email pembatalan terkirim dan reminder tidak terkirim; booking dengan mulai ±1 jam lagi → reminder terkirim
