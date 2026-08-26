## Why

Aplikasi belum memiliki notifikasi apa pun ke user: booking yang berhasil dibuat tidak diterima konfirmasinya via email, dan user mudah lupa datang pada waktu booking. Mengirim email langsung di dalam request handler bukan pilihan karena SMTP bisa lambat/gagal — itu akan menambah latensi dan berpotensi menggagalkan request yang sebenarnya sudah sukses. Pengiriman email perlu dipindahkan ke background job agar tetap andal tanpa memengaruhi respons API.

## What Changes

- Tambahkan infrastruktur background job berbasis **BullMQ + Redis** untuk pengiriman email asinkron.
- Tiga jenis email dalam Bahasa Indonesia:
  - **Konfirmasi** — saat booking berhasil dibuat (`POST /bookings`).
  - **Pembatalan** — saat booking dibatalkan (`PATCH /bookings/:id/cancel`).
  - **Reminder** — dijadwalkan sebagai delayed job yang dieksekusi **1 jam sebelum** `startTime` booking.
- Email dikirim via SMTP menggunakan dependency baru `nodemailer`.
- Worker BullMQ berjalan di **proses terpisah** (entry point baru `src/worker.ts`, script `worker`) sehingga API tidak terbebani pengiriman email.
- Job konfirmasi/pembatalan di-enqueue dari `bookings.service.ts` **setelah** transaksi database sukses (fire-and-forget; kegagalan enqueue tidak menggagalkan request). Job reminder dijadwalkan saat booking dibuat dan **dibatalkan** jika booking dicancel.
- Worker memverifikasi ulang status booking sebelum kirim sesuai jenis email (konfirmasi/reminder hanya untuk `confirmed`, pembatalan hanya untuk `cancelled`) sebagai guard anti-email basi.
- Retry otomatis job gagal dengan exponential backoff (default 3 percobaan); kegagalan akhir hanya tercatat di log, tidak mengubah hasil API.
- Variabel lingkungan baru: `REDIS_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (ditambahkan ke `.env.example`).

## Capabilities

### New Capabilities

- `booking-email-jobs`: Pengiriman email konfirmasi, pembatalan, dan reminder booking melalui background job BullMQ + Redis dengan worker proses terpisah, termasuk penjadwalan reminder H-1 jam dan perilaku retry.

### Modified Capabilities

- (kosong — tidak ada perubahan requirement pada kemampuan yang sudah ada)

## Impact

- **Kode**: file baru `src/jobs/` (definisi queue, processor, util penjadwalan), `src/mailer/` (transport SMTP + template teks), `src/worker.ts`; modifikasi `src/modules/bookings/bookings.service.ts` (enqueue setelah commit transaksi), `package.json` (script `worker`, dependency), `.env.example`.
- **API**: tidak ada perubahan endpoint, payload, maupun status respons — enqueue bersifat sampingan dan transparan bagi client.
- **Dependencies**: baru — `bullmq`, `ioredis`, `nodemailer`.
- **Systems**: butuh server Redis yang berjalan (`REDIS_URL`); worker adalah proses terpisah yang harus dijalankan bersama API (`bun run worker`). Tanpa worker berjalan, email tertumpah di queue dan tidak terkirim (API tetap normal).
