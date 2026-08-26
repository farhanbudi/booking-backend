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

# 7. Jalankan server API dan worker email (dua proses terpisah)
bun run dev
bun run worker
```

Server berjalan di **`http://localhost:3000`**, web UI Mailpit di **`http://localhost:8025`**.

### Data Awal (Hasil Seed)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `admin12345` |

Resource yang tersedia: Meeting Room A, Meeting Room B, Ruang Rapat Eksekutif, Pod Diskusi Kecil.

> Seed hanya perlu dijalankan sekali. Menjalankan ulang akan menghasilkan error `duplicate key`, yang merupakan perilaku normal.

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
├── jobs/
│   ├── queues.ts        # Definisi queue BullMQ (`booking-emails`)
│   ├── producers.ts     # Enqueue/schedule/remove job email
│   ├── processors.ts    # Processor: verifikasi status → render → kirim
│   └── types.ts         # Nama job & tipe payload
├── mailer/
│   ├── mailer.ts        # Transport SMTP (nodemailer)
│   └── templates.ts     # Template email plain-text (Bahasa Indonesia)
├── routes/
│   ├── auth.routes.ts
│   ├── resources.routes.ts
│   └── bookings.routes.ts
├── utils/
│   └── errors.ts          # Custom error classes
├── index.ts               # Entry point API
└── worker.ts              # Entry point worker email (proses terpisah)
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

### Menjalankan Redis & Mailpit (development)

```bash
docker run -d --name booking-redis -p 6379:6379 redis:7
docker run -d --name booking-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

- `booking-redis`: server queue (variabel `REDIS_URL`, default `redis://localhost:6379`).
- `booking-mailpit`: SMTP dummy yang menangkap semua email; lihat hasil kiriman di web UI `http://localhost:8025`.

Setelah itu jalankan worker bersama API (dua proses terpisah):

```bash
bun run dev     # API (producer job)
bun run worker  # worker email (consumer)
```

> Tanpa worker berjalan, email menumpuk di queue dan tidak terkirim — API tetap berjalan normal.
> Untuk produksi: gunakan penyedia SMTP (mis. Amazon SES, Resend SMTP) karena email dari localhost rawan diblokir, serta aktifkan persistensi Redis (AOF/RDB) agar delayed job reminder tidak hilang saat restart.

---

## Daftar Endpoint

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| `POST` | `/auth/register` | — | Registrasi akun baru |
| `POST` | `/auth/login` | — | Login, mendapatkan token JWT |
| `GET` | `/auth/me` | User | Profil pengguna yang sedang login |
| `GET` | `/resources` | User | Daftar resource (opsional: `?minCapacity=N`) |
| `POST` | `/resources` | Admin | Tambah resource baru |
| `PATCH` | `/resources/:id` | Admin | Perbarui data resource |
| `DELETE` | `/resources/:id` | Admin | Hapus resource |
| `GET` | `/bookings/availability` | User | Cek slot yang sudah terisi (`?resourceId=&date=YYYY-MM-DD`) |
| `POST` | `/bookings` | User | Buat booking baru |
| `GET` | `/bookings` | User | Riwayat booking milik pengguna yang login |
| `GET` | `/bookings/admin/all` | Admin | Seluruh booking dari semua pengguna |
| `PATCH` | `/bookings/:id/cancel` | User/Admin | Batalkan booking |

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
| `bun run dev` | Jalankan development server dengan hot-reload |
| `bun run start` | Jalankan server production |
| `bun run worker` | Jalankan worker email BullMQ (proses terpisah dari API) |
| `bun run db:generate` | Generate file migrasi dari schema |
| `bun run db:migrate` | Apply semua migrasi ke database |
| `bun run db:seed` | Isi data awal |
| `bun run test` | Jalankan semua automated test |
| `bun run test:watch` | Jalankan test dengan mode watch |
| `bun run test:server` | Jalankan server khusus e2e frontend (konfigurasi dari `.env.test`) |
| `bun run db:studio` | Buka Drizzle Studio |
