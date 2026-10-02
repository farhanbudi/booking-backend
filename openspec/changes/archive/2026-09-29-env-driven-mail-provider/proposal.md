## Why

Saat ini `src/mailer/mailer.ts` hanya tahu satu cara mengirim email: transport SMTP generik dari `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS`. Cara itu diam-diam bekerja untuk Mailpit (dev) maupun Resend (production), tapi tidak ada yang menyatakan hal itu secara eksplisit — pilihan provider tersembunyi di isi file `.env` production. Akibatnya, salah isi env di production bisa membuat emailDiam-diam terkirim ke host yang salah dan hilang tanpa suara.

Selain itu, deploy production memakai Resend free tier (3.000 email/bulan). Karena semua user terdaftar menerima email konfirmasi/pembatalan/reminder, kuota habis hanya oleh traffic demo — padahal yang sebenarnya perlu dideliver untuk demo hanyalah satu akun.

## What Changes

- **NEW**: env var `MAIL_PROVIDER` dengan dua nilai — `smtp` (dev/Mailpit, default) dan `resend` (production). Nilainya ditulis eksplisit di `.env`/`.env.example`, bukan ditebak dari `NODE_ENV`
- **NEW**: mode `resend` memakai SMTP Resend (`smtp.resend.com:465`, user `resend`, password = API key). Host/port/user di-hardcode di kode, tidak diexpose sebagai env
- **NEW**: env var `RESEND_API_KEY` — secret terpisah, bukan memakai ulang `SMTP_PASS`, supaya jelas di `.env.example` dan `render.yaml` bahwa isinya API key
- **NEW**: env var `DEMO_EMAIL` — saat `MAIL_PROVIDER=resend`, hanya email yang cocok dengan `DEMO_EMAIL` yang benar-benar di-deliver; sisanya dilewati
- **MODIFIED**: `sendMail()` di `src/mailer/mailer.ts` gaining guard `DEMO_EMAIL` di titik paling awal, sebelum menyentuh transport
- **MODIFIED**: opsi transport `secure` dari hardcode `false` menjadi `secure: port === 465` (Mailpit 1025 tetap non-secure, Resend 465 jadi TLS)
- **MODIFIED**: `validateEnv()` di `src/worker.ts` memanggil validasi provider baru; konfigurasi tidak valid menghentikan worker saat start dengan pesan Bahasa Indonesia
- **MODIFIED**: cek `SMTP_PORT harus berupa angka` dipindahkan dari `validateEnv()` ke validasi provider-aware, supaya tidak salah gagal saat `MAIL_PROVIDER=resend`
- **MODIFIED**: `.env.example` — tambah `MAIL_PROVIDER`, `RESEND_API_KEY`, `DEMO_EMAIL`; blok SMTP dianotasi sebagai khusus dev/Mailpit
- **MODIFIED**: `render.yaml` — set `MAIL_PROVIDER=resend`, tambah `RESEND_API_KEY` + `DEMO_EMAIL` sebagai `sync: false`, buang `SMTP_HOST/SMTP_USER/SMTP_PASS`
- **MODIFIED**: `README.md` — tabel Mailpit vs Resend, catatan domain `MAIL_FROM` harus terverifikasi di Resend, penjelasan mode demo
- **MODIFIED**: `AGENTS.md` — seksi Env & config menyebut `MAIL_PROVIDER` dan `DEMO_EMAIL`
- **NEW**: `tests/unit/mailer-config.test.ts` — cakupan untuk resolusi config dan filter `DEMO_EMAIL` di kedua provider

**Bukan BREAKING**: default `MAIL_PROVIDER` adalah `smtp` dan nilai `SMTP_*` yang ada sekarang tetap valid, sehingga konfigurasi lokal tidak berubah sama sekali.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `booking-email-jobs`: menambah dua requirement baru — pemilihan provider mail berbasis environment (termasuk fail-fast saat konfigurasi tidak valid, tanpa mengganggu proses `RUN_MODE=api`), dan pembatasan penerima email di mode demo (hanya `DEMO_EMAIL` yang di-deliver, sementara job BullMQ tetap diproses untuk semua user). Requirement yang sudah ada tidak berubah perilakunya.

## Impact

- `src/mailer/mailer.ts` — satu-satunya file yang berubah secara fungsional. Transport dibangun dari resolusi config provider, bukan dari env SMTP generis; `sendMail()` dapat early-return
- `src/worker.ts` — `validateEnv()` menambah pemanggilan validasi mail; cek `SMTP_PORT` yang lama dipindah. Tidak ada perubahan padaBullMQ setup, retry, atau event handler
- `src/jobs/processors.ts` — **tidak berubah**. `BookingEmailDeps.sendMail` sudah jadi seam injeksi, jadi seluruh switch provider terisolasi di `mailer.ts` dan test yang ada tidak perlu disentuh
- `src/index.ts` — **tidak berubah**. `closeMailer()` masih dipakai untuk graceful shutdown
- `.env` lokal — gitignored; pengguna sendiri yang menambahkan `MAIL_PROVIDER=smtp` dan `DEMO_EMAIL`
- Dependency — **tidak ada dependency baru**. Resend dijangkau lewat SMTP, bukan SDK, sehingga `package.json` dan `bun.lock` tidak berubah
- Infrastruktur — `render.yaml` kehilangan `SMTP_HOST/SMTP_USER/SMTP_PASS`, tapi nilainya **tetap menempel di dashboard Render** karena Render tidak menghapus env var yang dihapus dari file; dicatat di README
- Deployment — worker production yang dikonfigurasi `MAIL_PROVIDER=resend` tanpa `RESEND_API_KEY`/`DEMO_EMAIL` akan gagal start, bukan degrade diam-diam
