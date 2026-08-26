## Context

API hari ini berjalan sebagai satu proses Bun + ElysiaJS tanpa infrastruktur queue maupun dependency email. Semua operasi booking terpusat di `src/modules/bookings/bookings.service.ts` yang sudah membungkus pembuatan booking dalam `db.transaction` + `SELECT ... FOR UPDATE`. Model data yang relevan sudah lengkap: `users.email`, `resources.name`, `bookings.startTime/endTime/status` (enum `pending | confirmed | cancelled`, default `confirmed`) — tidak ada perubahan schema yang diperlukan. Test suite (`bun test`) berjalan terhadap database khusus via `.env.test` dan preload `tests/setup.ts` yang menolak `DATABASE_URL` non-test. Motivasi bisnis ada di proposal.md (bagian Why); requirement perilaku ada di delta spec `booking-email-jobs`.

## Goals / Non-Goals

**Goals:**

- Pengiriman email keluar sepenuhnya dari request path: API hanya memasukkan job, worker terpisah yang mengirim.
- Tiga jenis email (konfirmasi, pembatalan, reminder H-1 jam) dalam Bahasa Indonesia, plain text.
- Retry otomatis terbatas (3 percobaan, backoff eksponensial) sesuai spec.
- Guard status: worker selalu verifikasi ulang kondisi booking sebelum mengirim, sehingga reminder tidak dikirim untuk booking yang sudah dibatalkan.
- Testable tanpa Redis/SMTP nyata: seluruh logika inti (template, perhitungan delay, processor) terunit-test dengan mock.

**Non-Goals:**

- Template HTML, lampiran, atau i18n (plain text Bahasa Indonesia saja).
- Preferensi notifikasi per user, digest harian, atau channel lain (push/WA).
- Email untuk alur non-booking (registrasi, reset password).
- Dashboard monitoring queue (bull-board) dan autoscaling multi-worker.

## Decisions

### D1: BullMQ + ioredis sebagai queue engine

Sesuai permintaan eksplisit. Alternatif yang dipertimbangkan: `pg-boss` (queue di atas Postgres yang sudah ada, tanpa infra baru) — ditolak karena permintaan pengguna dan nilai portofolio menunjukkan pola queue standar industri. Catatan kompatibilitas: BullMQ resmi menarget Node.js; di Bun gunakan versi terbaru `bullmq` + `ioredis` dan jadikan smoke test koneksi Redis sebagai task paling awal implementasi.

### D2: Worker sebagai proses terpisah

Entry point baru `src/worker.ts` dijalankan lewat script `worker` (`bun run src/worker.ts`). Proses API bertindak hanya sebagai producer. Shutdown gracefully: tangani `SIGINT`/`SIGTERM` → `worker.close()` agar job yang sedang berjalan selesai sebelum exit. Alternatif worker in-process ditolak: membebani event loop API dan membuat restart API ikut memutus pengiriman email.

### D3: Satu queue, tiga nama job, payload minimal

Satu queue `booking-emails` dengan job name `confirmation` | `cancellation` | `reminder`. Payload job hanya `{ bookingId }`; processor melakukan re-fetch booking (join users + resources) lalu memverifikasi status sesuai jenis job — konfirmasi & reminder hanya dikirim bila `status === "confirmed"`, sedangkan pembatalan hanya dikirim bila `status === "cancelled"` (email pembatalan justru ditrigger oleh perubahan status itu sendiri) — sebelum render dan kirim. Ini membuat pengiriman idempoten terhadap retry dan tidak pernah memakai data basi. Alternatif menyimpan snapshot detail booking di payload ditolak: rawan stale (misal booking dicancel antara enqueue dan eksekusi).

### D4: Reminder sebagai delayed job dengan jobId deterministik

Delay dihitung saat enqueue: `delay = startTime - 1 jam - now`; jika hasilnya ≤ 0 (booking last-minute), reminder tidak dijadwalkan sama sekali. `jobId` deterministik `reminder-<bookingId>` (BullMQ melarang karakter `:` pada custom id) sehingga pembatalan cukup menghapus job tersebut (`queue.remove(jobId)`) tanpa struktur pelacakan tambahan. Durabilitas delayed job bergantung pada konfigurasi persistensi Redis (lihat Risiko).

### D5: Enqueue fire-and-forget setelah commit transaksi

Pemanggilan enqueue diletakkan di `bookings.service.ts` **setelah** transaksi DB sukses (bukan di dalamnya): buat booking → enqueue confirmation + schedule reminder; cancel booking → enqueue cancellation + remove reminder. Seluruh pemanggilan dibungkus try/catch: kegagalan queue hanya menghasilkan log warning, respons API tetap sukses — sesuai requirement "queuing failure does not fail the request".

### D6: Nodemailer + template teks murni

Modul `src/mailer/`: transport dibuat dari `SMTP_HOST/PORT/USER/PASS` dengan pengirim `MAIL_FROM`; template adalah fungsi murni `(data) => string` berbahasa Indonesia sehingga mudah dites tanpa mengirim apa pun. Untuk development disarankan Mailpit (docker, SMTP dummy dengan web UI) atau Mailtrap.

### D7: Konfigurasi dan strategi test

Env baru: `REDIS_URL` (default `redis://localhost:6379`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — ditambahkan ke `.env.example`; worker memvalidasi env saat start (fail fast). Strategi test mengikuti pola proyek (tanpa layanan eksternal): unit test template, unit test util perhitungan delay reminder, unit test processor dengan mailer & query di-mock, dan service test dengan producer yang di-mock — `bun test` tidak menuntut Redis/SMTP berjalan. Smoke test end-to-end (docker Redis + Mailpit) bersifat manual.

### D8: Kebijakan retry dan retensi job

`attempts: 3` dan backoff eksponensial basis 2 detik (percobaan ulang ±2s lalu ±4s) dikonfigurasi per job pada opsi `add()` di producer, karena BullMQ v6 tidak lagi menerima `attempts` di `WorkerOptions`. `removeOnComplete` dengan umur pendek agar riwayat sukses tidak menumpuk; `removeOnFail` menyimpan beberapa job gagal terakhir untuk inspeksi. Setelah attempts habis, BullMQ membuang/menandai job gagal — processor cukup melempar error, logging kegagalan akhir ditangani event `failed` worker.

## Risks / Trade-offs

- [Infrastruktur baru: Redis wajib tersedia] → Dokumentasikan `docker run -p 6379:6379 redis:7` di README; `REDIS_URL` punya default localhost; tanpa Redis API tetap hidup (enqueue gagal → log), hanya email yang tidak terkirim.
- [Kompatibilitas BullMQ/ioredis di runtime Bun] → Pin versi dependency; smoke test koneksi Redis menjadi task implementasi pertama; bila terjadi masalah spesifik Bun, worker bisa dijalankan dengan Node tanpa mengubah kode (keduanya JavaScript biasa).
- [Delayed job hilang jika Redis kehilangan data (restart tanpa persistensi)] → Aktifkan AOF/RDB pada Redis produksi; untuk skala portofolio risiko ini diterima dan didokumentasikan.
- [Semantik at-least-once: email bisa terkirim dobel bila worker mati tepat setelah SMTP accept tapi sebelum ack] → Diterima; probabilitas rendah, dampak rendah (email dobel), mitigasi berupa verifikasi status di processor tetap dilakukan.
- [Email dari SMTP lokal/dev rawan masuk spam atau diblokir] → Development memakai Mailpit/Mailtrap yang menangkap semua email; catatan di README bahwa produksi sebaiknya memakai penyedia SMTP (mis. SES, Resend SMTP).

## Migration Plan

1. Install `bullmq`, `ioredis`, `nodemailer`; tambahkan env baru ke `.env.example`.
2. Siapkan Redis (lokal: docker). Tidak ada migrasi database — schema tidak berubah.
3. Jalankan worker bersamaan dengan API (`bun run worker`). Urutan aman: Redis → worker → API (atau sebaliknya; keduanya reconnect otomatis).
4. Rollback: hentikan proses worker dan kembalikan kode sebelumnya; tidak ada jejak data yang perlu dibersihkan (job tertahan aman di Redis).

## Open Questions

(tidak ada — semua keputusan material sudah dikunci bersama pengguna: provider SMTP, waktu reminder H-1 jam, model worker terpisah, dan cakupan termasuk email pembatalan.)
