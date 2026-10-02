# Tasks — env-driven-mail-provider

## 1. Resolusi config provider di `src/mailer/mailer.ts`

- [x] 1.1 Tambahkan `type MailProvider = "smtp" | "resend"` dan `resolveMailProvider()` yang membaca `MAIL_PROVIDER` dengan default `"smtp"`; verifikasi: unit test mengembalikan `"smtp"` saat env kosong
- [x] 1.2 Tambahkan `resolveTransportOptions()` yang mengembalikan opsi transport per provider — `smtp` dari `SMTP_HOST`/`SMTP_PORT` (default `localhost`/`1025`) dengan auth hanya bila `SMTP_USER` **dan** `SMTP_PASS` terisi; `resend` ke `smtp.resend.com:465` dengan user `resend` dan password `RESEND_API_KEY`; verifikasi: unit test menguji kedua mode termasuk kasus hanya satu dari `SMTP_USER`/`SMTP_PASS` terisi
- [x] 1.3 Ubah `secure` dari hardcode `false` menjadi `secure: port === 465`; verifikasi: unit test menunjukkan port 1025 → `secure: false` dan port 465 → `secure: true`
- [x] 1.4 Pastikan nilai `RESEND_API_KEY` tidak muncul di output `describeMailTransport()` maupun log mana pun; verifikasi: unit test memeriksa string deskripsi tidak memuat isi API key

## 2. Validasi env mail

- [x] 2.1 Tambahkan `validateMailEnv(): string[]` yang mengembalikan daftar pesan Bahasa Indonesia — nilai `MAIL_PROVIDER` tak dikenal, `RESEND_API_KEY` kosong saat mode `resend`, `DEMO_EMAIL` kosong saat mode `resend`, `SMTP_PORT` non-numerik **hanya saat mode `smtp`**; verifikasi: unit test menutupi seluruh kasus
- [x] 2.2 Tambahkan `isDemoRecipient(to: string): boolean` sebagai seam murni — perbandingan case-insensitive dan tahan spasi di sekitar; verifikasi: unit test lolos untuk `budi@example.com` vs `DEMO_EMAIL=Budi@Example.com`
- [x] 2.3 Tambahkan `describeMailTransport(): string` untuk log startup, memuat provider aktif dan penerima demo bila mode `resend`; verifikasi: unit test memeriksa isi string deskripsi

## 3. Guard `DEMO_EMAIL` di `sendMail()`

- [x] 3.1 Tambahkan guard di awal `sendMail()`: bila provider `resend` dan `isDemoRecipient(to)` false, catat log skip lalu `return` **sebelum** menyentuh transport; verifikasi: stub nodemailer membuktikan `transport.sendMail` tidak terpanggil
- [x] 3.2 Pastikan `sendMail()` tetap melempar error normally saat provider `resend` dan penerima adalah akun demo, sehingga retry BullMQ tidak berubah; verifikasi: unit test memakai transport yang melempar error dan memastikan error diteruskan
- [x] 3.3 Pastikan guard tidak berlaku di mode `smtp` — semua penerima dikirim; verifikasi: unit test
- [x] 3.4 Pastikan job yang di-skip tidak diperlakukan sebagai kegagalan oleh BullMQ (tidak ada `throw` di jalur skip); verifikasi: `sendMail` pada jalur skip resolve tanpa error

## 4. Integrasi ke `src/worker.ts`

- [x] 4.1 Pindahkan cek `SMTP_PORT harus berupa angka` keluar dari `validateEnv()` dan ke dalam `validateMailEnv()`; verifikasi: worker dengan `MAIL_PROVIDER=resend` dan `SMTP_PORT=abc` tetap start (dibuktikan dijalankan)
- [x] 4.2 Panggil `validateMailEnv()` dari `validateEnv()`; bila hasilnya tidak kosong, `console.error` semua pesan lalu `process.exit(1)`; verifikasi: worker dengan `MAIL_PROVIDER=resend` tanpa `RESEND_API_KEY` berhenti dengan exit non-zero (dibuktikan dijalankan)
- [x] 4.3 Tambahkan log `describeMailTransport()` saat worker start berhasil; verifikasi: log terbaca `[email-worker] mail via resend (smtp.resend.com:465), penerima demo: demo@example.com` (dibuktikan dijalankan)
- [x] 4.4 Pastikan `RUN_MODE=api` tidak terpengaruh — validasi hanya di `startWorker()`; verifikasi: `validateMailEnv()` hanya dipanggil dari `startWorker()`, sehingga `RUN_MODE=api` tidak pernah menyentuh validasi ini (dibuktikan dari struktur kode; e2e perlu Redis)

## 5. Test

- [x] 5.1 Buat `tests/unit/mailer-config.test.ts` mencakup `resolveMailProvider()`, `resolveTransportOptions()`, `validateMailEnv()`, `isDemoRecipient()`, dan `describeMailTransport()`; verifikasi: `bun test tests/unit/mailer-config.test.ts` lolos
- [x] 5.2 Pastikan test me-reset env yang dimodifikasi di `afterEach` agar tidak bocor ke file test lain dalam satu proses; verifikasi: `bun test` (seluruh suite) — 125 pass, tidak ada regresi
- [x] 5.3 Pastikan `tests/unit/processors.test.ts` dan test lain **tidak** perlu diubah; verifikasi: `git status` bersih untuk file test lama

> Catatan implementasi: verifikasi 3.1–3.4 butuh stub transport, sedangkan `mailer.ts` membangun transport di level modul. Agar `mock.module` terdaftar sebelum `mailer.ts` di-import (semua file test berbagi satu proses), stub-nya dipisah ke `tests/helpers/fake-nodemailer.ts` dan dipakai bersama oleh dua file test baru: `mailer-config.test.ts` dan `mailer-send.test.ts`. Total 29 test baru.

## 6. Konfigurasi & dokumentasi

- [x] 6.1 Update `.env.example`: tambah `MAIL_PROVIDER=smtp`, `RESEND_API_KEY`, `DEMO_EMAIL`; anotasikan blok `SMTP_*` sebagai khusus dev/Mailpit; verifikasi: file terbaca jelas tanpa konteks tambahan
- [x] 6.2 Update `render.yaml`: set `MAIL_PROVIDER=resend`, tambah `RESEND_API_KEY` dan `DEMO_EMAIL` sebagai `sync: false`, hapus `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`; verifikasi: tidak ada kunci `SMTP_` tersisa
- [x] 6.3 Update `README.md` seksi "Email & Background Job": tabel Mailpit (dev) vs Resend (production), penjelasan mode demo `DEMO_EMAIL`, dan catatan bahwa domain `MAIL_FROM` harus terverifikasi di Resend
- [x] 6.4 Tambahkan catatan di README bahwa menghapus `SMTP_*` dari `render.yaml` tidak menghapus nilainya dari dashboard Render
- [x] 6.5 Update `AGENTS.md` seksi "Env & config" agar menyebut `MAIL_PROVIDER`, `RESEND_API_KEY`, dan `DEMO_EMAIL`

## 7. Verifikasi menyeluruh

- [x] 7.1 `bun test` — 125 pass. **11 fail yang sudah ada sebelumnya** (baseline `cd40b34` juga 11 fail / 96 pass): 9 test timeout 5 detik di `bookings API`, `rate limit`, dan `double-booking race condition`, plus 2 test `payments-webhook-signature` (env Stripe). Tidak terkait perubahan ini.
- [x] 7.2 `bunx tsc --noEmit` — 0 error
- [x] 7.3 `bun run start` dengan `MAIL_PROVIDER=smtp` — **terverifikasi end-to-end** dengan container `redis` + `booking-mailpit` aktif:
  - Worker start dengan log `[email-worker] mail via smtp (localhost:1025)`
  - Booking dibuat lewat API nyata pada resource gratis (`Pod Diskusi kecil`, `pricePerHour: 0`) → status `confirmed`
  - Worker memproses job: `[email-worker] job confirmation (20) selesai`
  - Mailpit menerima email `Konfirmasi Booking - Pod Diskusi Kecil` ke `e2e-73@example.com`
  - Terrein bonus: kiriman juga tembus ke tiga penerima non-demo lewat `sendMail()` langsung (`demo@`, `budi@`, `siti@example.com`) — membuktikan guard `DEMO_EMAIL` benar-benar tidak berlaku di mode `smtp`
- [x] 7.4 `MAIL_PROVIDER=resend` tanpa `RESEND_API_KEY` — worker berhenti dengan pesan jelas, bukan crash (dibuktikan: exit 1, dua pesan tercetak)
- [x] 7.5 `MAIL_PROVIDER=rsend` (typo) — worker berhenti dengan pesan "tidak dikenali", tanpa fallback diam-diam (dibuktikan: exit 1)
- [x] 7.6 Verifikasi tidak ada `console.log` yang mencetak `RESEND_API_KEY` — `RESEND_API_KEY` hanya muncul di `auth.pass`, di nama variabel dalam pesan error, dan tidak pernah di `describeMailTransport()`
