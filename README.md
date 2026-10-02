# Booking Backend

REST API untuk sistem pemesanan ruangan/resource dengan fokus pada penanganan **race condition** dan pencegahan **double-booking**.

Frontend: [`booking-frontend`](https://github.com/farhanbudi/booking-frontend)

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Framework | [ElysiaJS](https://elysiajs.com) (type-safe, validasi via TypeBox) |
| Database | PostgreSQL |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Auth | JWT (`@elysiajs/jwt`) + Argon2id via `Bun.password` |
| Background Job | [BullMQ](https://docs.bullmq.io) + Redis (email konfirmasi/pembatalan/reminder) |
| Logging | [pino](https://getpino.io) (NDJSON) + [`@bogeychan/elysia-logger`](https://github.com/bogeychan/elysia-logger) untuk request/error otomatis |

---

## Instalasi

### Prasyarat

- [Bun](https://bun.sh) ≥ 1.0
- PostgreSQL
- Redis + SMTP (untuk fitur email background job; keduanya bisa dijalankan lewat Docker — lihat bagian [Email & Background Job](#email--background-job))

### Langkah Setup

```bash
# 1. Install dependensi
bun install

# 2. Salin dan isi konfigurasi environment
cp .env.example .env
# Isi DATABASE_URL dan JWT_SECRET di .env

# 3. Generate dan apply migrasi
bun run db:generate
bun run db:migrate

# 4. Apply exclusion constraint (wajib, untuk proteksi double-booking)
psql $DATABASE_URL -f src/db/migrations/manual_0001_exclusion_constraint.sql

# 5. Isi data awal (4 ruangan + 1 akun admin)
bun run db:seed

# 6. Jalankan Redis dan SMTP dummy untuk email (lihat bagian Email & Background Job)
docker run -d --name booking-redis -p 6379:6379 redis:7
docker run -d --name booking-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit

# 7. Jalankan aplikasi (server + worker berjalan bareng dalam 1 proses)
bun run dev
```

Server berjalan di **`http://localhost:3000`**, web UI Mailpit di **`http://localhost:8025`**.

### Data Awal (Hasil Seed)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `admin12345` |

Resource yang tersedia: Meeting Room A, Meeting Room B, Ruang Rapat Eksekutif, Pod Diskusi Kecil.

> Seed hanya perlu dijalankan sekali. Menjalankan ulang akan menghasilkan error `duplicate key`, yang merupakan perilaku normal.

---

## RUN_MODE

Aplikasi mendukung variabel lingkungan `RUN_MODE` untuk mengontrol proses mana yang dijalankan:

| RUN_MODE | Perilaku | Dipakai saat |
|---|---|---|
| `all` (default) | Server API + Worker email berjalan bareng dalam 1 proses | Deploy tier gratis Render (1 Web Service) |
| `api` | Hanya server API yang berjalan | Deploy sebagai Web Service terpisah |
| `worker` | Hanya worker email yang berjalan | Deploy sebagai Background Worker terpisah (bukan tier gratis) |

**Cara deploy ke Render tier gratis (1 service):**
- Tidak perlu mengatur `RUN_MODE` — defaultnya `"all"`, server + worker berjalan bareng dalam satu proses Bun.
- Repo ini sudah punya blueprint `render.yaml` (1 Web Service saja — Postgres dan Redis berada di luar Render). Di dashboard Render pilih **New → Blueprint**, arahkan ke repo ini, lalu isi nilai untuk semua variabel `sync: false` (rahasia) saat diminta. Root Directory dan Build Filters dibiarkan kosong.
- `PORT` tidak perlu di-set — Render yang menentukannya.

> **Catatan:** Render hanya meminta nilai `sync: false` saat blueprint dibuat pertama kali. Nilai yang diubah manual di dashboard akan **ditimpa oleh isi `render.yaml`** setiap kali blueprint di-sync ulang, selama key-nya masih dideklarasikan di sana. JANGAN unggah `.env` sebagai Secret File — Render menaruhnya sebagai file biasa di direktori service dan Bun tidak menimpa process env dengan isi `.env`, jadi hasilnya ambigu. Pakai Environment Variables saja.

> **Catatan tier gratis Render:** Web Service tidur setelah 15 menit tanpa request, sehingga job BullMQ baru diproses setelah service bangun. Karena Postgres dan Redis di luar Render, keduanya harus tetap hidup 24/7 dan mengizinkan koneksi masuk dari IP egress Render (free plan tidak punya IP egress statis, jadi opsi paling aman adalah firewall berbasis password/whitelist atau jaringan privat).

**Setelah deploy pertama, wajib dijalankan manual:**
1. `bun run db:migrate` (atau `bunx drizzle-kit migrate`) terhadap `DATABASE_URL` production.
2. Exclusion constraint untuk proteksi double-booking **tidak** ada di migration Drizzle, jadi harus dipasang manual:
   ```
   psql $DATABASE_URL -f src/db/migrations/manual_0001_exclusion_constraint.sql
   ```
   Tanpa langkah ini, proteksi double-booking di level database tidak aktif.
3. `bun run db:seed` sekali saja untuk membuat user admin.

**Cara deploy dengan 2 service (jika diperlukan di masa depan):**
- Web Service: set `RUN_MODE=api`
- Background Worker: set `RUN_MODE=worker`
- **Catatan**: Background Worker di Render bukan tier gratis — ini keputusan infrastruktur, bukan kode.

---

## Struktur Proyek

```
src/
├── db/
│   ├── client.ts          # Koneksi Drizzle + postgres.js
│   ├── schema.ts          # Definisi tabel (users, resources, bookings)
│   ├── migrate.ts         # Runner migrasi
│   ├── seed.ts            # Data awal
│   └── migrations/        # File migrasi SQL (termasuk exclusion constraint)
├── middleware/
│   └── auth.middleware.ts # JWT verification + role guard
├── modules/
│   ├── auth/              # Register, login, profile
│   ├── resources/         # CRUD resource
│   └── bookings/          # Pengecekan ketersediaan + pembuatan booking
├── queue.ts               # Definisi Queue BullMQ + koneksi Redis
├── server.ts              # Setup Elysia app + route (startServer)
├── worker.ts              # Logic worker BullMQ (startWorker)
├── jobs/
│   ├── producers.ts       # Enqueue/schedule/remove job email
│   ├── processors.ts      # Processor: verifikasi status → render → kirim
│   └── types.ts           # Nama job & tipe payload
├── mailer/
│   ├── mailer.ts        # Transport SMTP (nodemailer)
│   └── templates.ts     # Template email plain-text (Bahasa Indonesia)
├── routes/
│   ├── auth.routes.ts
│   ├── resources.routes.ts
│   └── bookings.routes.ts
├── utils/
│   └── errors.ts          # Custom error classes
├── index.ts               # Entry point: baca RUN_MODE, putuskan server/worker
└── run-test-server.ts     # Server e2e untuk test frontend
```

---

## Pencegahan Double-Booking

Sistem menggunakan **dua lapis proteksi** untuk memastikan tidak ada dua booking yang overlap pada resource yang sama.

### Lapis 1 — Application Level (`bookings.service.ts`)

Sebelum melakukan `INSERT`, sistem menjalankan query `SELECT ... FOR UPDATE` di dalam sebuah database transaction:

```sql
SELECT id FROM bookings
WHERE resource_id = $1
  AND status <> 'cancelled'
  AND tstzrange(start_time, end_time) && tstzrange($2::timestamptz, $3::timestamptz)
FOR UPDATE
```

`FOR UPDATE` mengunci baris-baris yang relevan sehingga dua request yang datang secara bersamaan tidak dapat lolos pengecekan overlap secara bersamaan.

### Lapis 2 — Database Level (`manual_0001_exclusion_constraint.sql`)

PostgreSQL **exclusion constraint** dengan ekstensi `btree_gist` menolak setiap `INSERT` yang rentang waktunya (`tstzrange`) overlap dengan booking aktif lain pada resource yang sama.

```sql
ALTER TABLE bookings
ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING GIST (
  resource_id WITH =,
  tstzrange(start_time, end_time) WITH &&
)
WHERE (status <> 'cancelled');
```

**Alasan menggunakan dua lapis:**

- Lapis 1 memberikan respons error yang informatif kepada pengguna secepat mungkin.
- Lapis 2 menjamin integritas data pada level database, terlepas dari kondisi yang terjadi di application layer.

---

## Email & Background Job

Email dikirim **asinkron** lewat background job [BullMQ](https://docs.bullmq.io) + Redis sehingga lambat/gagalnya SMTP tidak pernah memengaruhi respons API:

| Email | Pemicu |
|---|---|
| Konfirmasi | Booking berhasil dibuat (`POST /bookings`) |
| Pembatalan | Booking dibatalkan (`PATCH /bookings/:id/cancel`) |
| Reminder | Delayed job yang dieksekusi 1 jam sebelum `startTime` booking |

Reminder tidak dikirim bila booking sudah dibatalkan, dan tidak dijadwalkan untuk booking last-minute (mulai < 1 jam lagi). Job gagal dicoba ulang otomatis maksimal **3 percobaan** dengan exponential backoff. Sebelum mengirim, worker selalu memverifikasi ulang status booking di database.

### Memilih provider email

Transport email ditentukan oleh satu env var, `MAIL_PROVIDER`:

| `MAIL_PROVIDER` | Dipakai untuk | Transport | Env yang dibutuhkan |
|---|---|---|---|
| `smtp` (default) | Development | Mailpit di `localhost:1025` | `SMTP_HOST`, `SMTP_PORT` (opsional) |
| `mailgun` | Production | SMTP Mailgun | `MAILGUN_SMTP_HOST`, `MAILGUN_SMTP_PORT`, `MAILGUN_SMTP_LOGIN`, `MAILGUN_SMTP_PASSWORD`, `DEMO_EMAIL` |

`MAIL_FROM` dipakai di kedua mode. Nilai `MAIL_PROVIDER` yang tidak dikenali membuat worker **berhenti start** dengan pesan jelas — sengaja tidak fallback diam-diam, karena fallback diam-diam akan mengirim email produksi ke host yang salah. Mode `mailgun` juga berhenti start kalau salah satu dari empat variabel `MAILGUN_SMTP_*` atau `DEMO_EMAIL` kosong. Proses `RUN_MODE=api` tidak terpengaruh, karena tidak pernah mengirim email.

Keempat `MAILGUN_SMTP_*` diisi langsung dari kredensial SMTP yang diberikan Mailgun (menu **Sending → SMTP credentials**): hostname, port, login, dan password. Opsi `secure` tidak diset manual — nodemailer mengaktifkannya hanya bila port-nya 465, sedangkan port 587 memakai STARTTLS.

#### Mode demo di produksi

Kuota free tier Mailgun terbatas (100 email/hari), sedangkan semua user terdaftar bisa membuat booking. Karena itu `DEMO_EMAIL` menentukan satu-satunya alamat yang benar-benar menerima email di mode `mailgun`:

- Job tetap dibuat dan diproses untuk **semua** user — antrean, pengecekan status booking, dan render template tidak berubah.
- Hanya pengiriman ke alamat selain `DEMO_EMAIL` yang dilewati, dan job itu dianggap **berhasil** (tidak di-retry, tidak tercatat gagal). Setiap dilewati menghasilkan satu baris log di output worker.
- Pencocokan alamat mengabaikan huruf besar-kecil dan spasi di sekitar.
- Menghapus `DEMO_EMAIL` tidak otomatis membuat semua user dikirimi email — worker justru berhenti start. Going live ke semua user adalah keputusan yang disengaja.

> **Sebelum deploy:** domain pada `MAIL_FROM` harus sudah diverifikasi di Mailgun (menu Domains). Kalau belum, semua email ditolak, retry 3×, lalu job di-discard — gejalanya baru terlihat dari log worker, bukan dari proses startup.

### Menjalankan Redis & Mailpit (development)

```bash
docker run -d --name redis --restart unless-stopped -p 6379:6379 redis:7
docker run -d --name booking-mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 axllent/mailpit
```

- `booking-redis`: server queue (variabel `REDIS_URL`, default `redis://localhost:6379`).
- `booking-mailpit`: SMTP dummy yang menangkap semua email; lihat hasil kiriman di web UI `http://localhost:8025`. Karena Mailpit tidak punya kuota, semua user tetap dikirimi email di mode `smtp`.

Setelah itu jalankan worker bersama API (dua proses terpisah):

```bash
bun run dev     # API (producer job)
bun run worker  # worker email (consumer)
```

> Tanpa worker berjalan, email menumpuk di queue dan tidak terkirim — API tetap berjalan normal.
> Untuk produksi: set `MAIL_PROVIDER=mailgun` beserta keempat `MAILGUN_SMTP_*` dan `DEMO_EMAIL`, serta aktifkan persistensi Redis (AOF/RDB) agar delayed job reminder tidak hilang saat restart.

### Catatan Render

`render.yaml` tidak lagi mendeklarasikan `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` karena production memakai `MAIL_PROVIDER=mailgun`. Menghapus kunci dari `render.yaml` **tidak menghapus** nilainya dari dashboard Render — Render hanya berhenti meminta nilainya. Nilai lama masih menempel di sana dan tidak berbahaya selama `MAIL_PROVIDER=mailgun`, tapi perlu diketahui saat rollback. Sama seperti keys yang dihapus, `RESEND_API_KEY` lama juga masih menempel di dashboard; worker mengabaikannya karena `MAIL_PROVIDER=mailgun`.

---

## Pembayaran (Simulasi Stripe Test Mode)

Resource dapat diberi harga per jam lewat kolom `pricePerHour` (admin, `POST/PATCH /resources`). Alur booking menyesuaikan:

| Resource | Perilaku |
|---|---|
| `pricePerHour` kosong / 0 | Gratis — langsung `confirmed`, email konfirmasi + reminder dijadwalkan saat create (perilaku lama) |
| `pricePerHour` > 0 | Berbayar — booking masuk status `pending`, API mengembalikan `{ booking, payment: { checkoutUrl, expiresAt } }`; slot **tetap ditahan** selama pending |

Booking berbayar menjadi `confirmed` hanya setelah webhook `checkout.session.completed` dari Stripe. Jika tidak dibayar dalam `PAYMENT_EXPIRY_MINUTES` (default 15), delayed job `expire-payment` membatalkannya otomatis dan slot kembali bebas — **tanpa** email apa pun. Email konfirmasi + reminder baru dikirim tepat setelah pembayaran sukses. Pemilik booking pending bisa meminta URL checkout segar kapan saja via `GET /bookings/:id/checkout-url` (403 bila bukan pemilik, 409 bila bukan pending).

Konfirmasi pembayaran bersifat idempoten: webhook duplikat, event untuk booking yang sudah dibatalkan, atau job expiry yang datang terlambat semuanya jadi no-op aman lewat satu gerbang transisi kondisional (`UPDATE ... WHERE status='pending'`).

### Env pembayaran

```env
STRIPE_SECRET_KEY=sk_test_...        # wajib untuk alur berbayar
STRIPE_WEBHOOK_SECRET=whsec_...      # tanpa ini endpoint webhook merespons 503
PAYMENT_CURRENCY=idr                 # amount dikirim dalam satuan terkecil (×100)
PAYMENT_EXPIRY_MINUTES=15            # TTL pending sebelum auto-cancel
PAYMENT_SUCCESS_URL=http://localhost:5173/payments/success
PAYMENT_CANCEL_URL=http://localhost:5173/payments/cancel
```

### Menguji webhook secara lokal

Webhook butuh URL publik; gunakan Stripe CLI untuk meneruskan event ke localhost:

```bash
stripe login
stripe listen --forward-to localhost:3000/payments/webhook
# salin whsec_... yang tercetak ke STRIPE_WEBHOOK_SECRET di .env, lalu restart API
```

Kartu tes di halaman Checkout: `4242 4242 4242 4242` (tanggal/CSV bebas). Tanpa CLI, booking tetap bisa dibuat dan URL checkout dibuka, tapi tanpa event webhook booking akan hang di `pending` sampai dibatalkan otomatis oleh job expiry — itu fallback yang disengaja.

Kartu tes untuk gagal checkout: `4000 0000 0000 0002`

> **Pitfall jumlah minimum (akun Stripe settlement = MYR):** akun Stripe yang dipakai memperlakukan IDR sebagai mata uang 2-desimal, sehingga `unit_amount` harus dikirim dalam satuan terkecil (Rp50.000 → `5000000`). Mengirim langsung (`50000`) gagal dengan `amount_too_small` karena Stripe membacanya sebagai Rp500,00 (di bawah minimum `RM2,00`). Logika pengalian ×100 ada di `src/modules/payments/pricing.ts`. Jika mengganti ke akun dengan settlement IDR, kembalikan perlakuan zero-decimal agar tidak terjadi overcharge 100×.

---

## Logging

Aplikasi menggunakan logger terpusat berbasis [pino](https://getpino.io) yang
diteruskan ke lifecycle Elysia lewat [`@bogeychan/elysia-logger`](https://github.com/bogeychan/elysia-logger).
Seluruh output ditulis dalam format **NDJSON** (satu JSON per baris) ke dua tujuan:

| Tujuan | Isi |
|---|---|
| `stdout` | Baris NDJSON mentah di production, atau format `pino-pretty` berwarna di development |
| `logs/app.log` | Selalu NDJSON mentah, satu file (di-`gitignore`) |

Level log dikontrol lewat env `LOG_LEVEL` (default `info` di production, `debug`
di development). Field sensitif — `password`, `passwordHash`, dan
`Authorization` header — otomatis disensor menjadi `"[REDACTED]"` lewat
konfigurasi `redact` pino, sehingga password tidak akan pernah bocor ke log.

### Event yang di-log

- **Request/error otomatis** (dari `elysiaLogger`): semua request masuk + response,
  plus error 4xx sebagai `warn` dan 5xx sebagai `error`.
- **Bisnis — `bookings`**: `warn` saat double-booking terdeteksi (oleh cek
  `FOR UPDATE` maupun exclusion constraint), `info` saat booking berhasil dibuat.
- **Bisnis — `auth`**: `warn` saat login gagal (email tidak ditemukan / password
  salah) — hanya `email` yang dicatat, tanpa password.

### Melihat log secara real-time

Dua script tersedia di `package.json`, keduanya cross-platform (Windows/macOS/Linux)
dan polling `fs.statSync` setiap 100 ms — tidak butuh `tail`/`grep` di PATH.

| Script | Tujuan | Cocok untuk |
|---|---|---|
| `bun run logs:tail` | Live-tail `logs/app.log` lewat `pino-pretty` (output verbos: method, path, status, headers, response time) | Debugging detail satu request |
| `bun run logs:tail:simple` | Live-tail dengan filter event bisnis (warn/error selalu, info hanya untuk event `login`/`booking`/`payment`/`user dibuat`/`request error`) | Monitoring umum — output 1 baris per event penting |

```bash
# Terminal 1: jalankan server
bun run dev

# Terminal 2: pantau event penting saja (cocok untuk penggunaan harian)
bun run logs:tail:simple
```

Contoh output `logs:tail:simple` saat ada login gagal, error 500, dan booking
sukses dalam satu waktu:

```
2026-09-04T07:01:02.000Z  WARN   password salah            email=user@test.com
2026-09-04T07:01:03.000Z  ERROR  request error             statusCode=500 err={"type":"Error","message":"DB down"}
2026-09-04T07:01:05.000Z  INFO   payment received          paymentId=p-1 amount=50000
2026-09-04T07:01:06.000Z  INFO   booking berhasil dibuat   bookingId=b42 resourceId=r1 userId=u7
```

Auto-log info dari Elysia (`incoming request`, `request completed`, dll)
disaring supaya tidak memenuhi layar — pakai `logs:tail` (bukan `:simple`)
kalau memang perlu melihat detail request per HTTP.

---

## Daftar Endpoint

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| `POST` | `/auth/register` | — | Registrasi akun baru |
| `POST` | `/auth/login` | — | Login, mendapatkan token JWT |
| `GET` | `/auth/me` | User | Profil pengguna yang sedang login |
| `GET` | `/resources` | User | Daftar resource (opsional: `?minCapacity=N`) |
| `POST` | `/resources` | Admin | Tambah resource baru |
| `PATCH` | `/resources/:id` | Admin | Perbarui data resource (`pricePerHour` opsional) |
| `DELETE` | `/resources/:id` | Admin | Hapus resource |
| `GET` | `/bookings/availability` | User | Cek slot yang sudah terisi (`?resourceId=&date=YYYY-MM-DD`) |
| `POST` | `/bookings` | User | Buat booking baru; resource berbayar → respons berisi `payment.checkoutUrl` |
| `GET` | `/bookings/:id/checkout-url` | User (pemilik) | URL checkout segar untuk booking pending |
| `GET` | `/bookings` | User | Riwayat booking milik pengguna yang login |
| `GET` | `/bookings/admin/all` | Admin | Seluruh booking dari semua pengguna |
| `PATCH` | `/bookings/:id/cancel` | User/Admin | Batalkan booking |
| `POST` | `/payments/webhook` | — (signature Stripe) | Webhook `checkout.session.completed/expired` |

---

## Testing

Automated tests menggunakan test runner bawaan Bun (`bun:test`) — tidak ada dependency
tambahan. Test berjalan terhadap **database test terpisah**, bukan database development.

### Prasyarat

- PostgreSQL berjalan secara lokal.
- Database test `booking_test` tersedia (dibuat otomatis oleh helper saat `bun run test`).

### Konfigurasi

Test memakai file env khusus `.env.test` (dimuat otomatis oleh `bun test` dan dieksplisitkan
oleh `tests/setup.ts`), dengan `DATABASE_URL` mengarah ke database test `booking_test`.
Database development yang ada di `.env` tidak tersentuh.

### Menjalankan test

```bash
bun run test          # jalankan semua test sekali
bun run test:watch    # mode watch
```

### Server untuk test e2e (frontend)

Untuk menguji frontend secara end-to-end, backend perlu berjalan dengan konfigurasi
test (`PORT=3001`, `DATABASE_URL` → `booking_test`). Jalankan:

```bash
bun run test:server
```

Script ini:

1. Memuat `.env.test` (bukan `.env`) dan memastikan `DATABASE_URL` mengarah ke database test.
2. Menyiapkan database test: membuat database bila belum ada, menjalankan migrasi, dan memasang exclusion constraint `no_overlapping_bookings` (idempoten).
3. Me-reset seluruh tabel lalu mengisi data awal (4 resource + akun admin `admin@example.com` / `admin12345`) supaya state e2e selalu deterministik di setiap start.
4. Menjalankan server di **`http://localhost:3001`**.

> Server e2e ini tidak menyentuh database development yang ada di `.env`.

Yang diuji:

| Tingkat | Cakupan |
|---|---|
| Unit (service) | Auth, resource, booking (termasuk validasi startTime/endTime, slot terisi, cancel ownership) |
| API (integration) | Seluruh endpoint, auth guard, role guard admin, validasi input |
| Concurrency | Membuktikan dua booking overlap bersamaan hanya satu yang berhasil (race condition / double-booking) |

> Catatan: test concurrency membutuhkan exclusion constraint `no_overlapping_bookings` ada di
> database test — helper `tests/helpers/test-db.ts` memastikan constraint tersebut terpasang
> (idempoten) setiap kali test dijalankan.

---

## Scripts

| Command | Keterangan |
|---|---|
| `bun run dev` | Jalankan development server + worker (hot-reload, 1 proses) |
| `bun run dev:api` | Jalankan server API saja (hot-reload, RUN_MODE=api) |
| `bun run dev:worker` | Jalankan worker saja (hot-reload, RUN_MODE=worker) |
| `bun run start` | Jalankan server production (RUN_MODE=all default) |
| `bun run db:generate` | Generate file migrasi dari schema |
| `bun run db:migrate` | Apply semua migrasi ke database |
| `bun run db:seed` | Isi data awal |
| `bun run test` | Jalankan semua automated test |
| `bun run test:watch` | Jalankan test dengan mode watch |
| `bun run test:server` | Jalankan server khusus e2e frontend (konfigurasi dari `.env.test`) |
| `bun run db:studio` | Buka Drizzle Studio |
| `bun run logs:tail` | Live-tail `logs/app.log` lewat `pino-pretty` (verbos, untuk debugging) |
| `bun run logs:tail:simple` | Live-tail dengan filter event bisnis (cocok untuk monitoring harian) |
