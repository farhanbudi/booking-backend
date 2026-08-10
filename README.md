# Booking Backend

REST API untuk sistem pemesanan ruangan/resource dengan fokus pada penanganan **race condition** dan pencegahan **double-booking**.

Frontend: [`../booking-frontend`](../booking-frontend)

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Framework | [ElysiaJS](https://elysiajs.com) (type-safe, validasi via TypeBox) |
| Database | PostgreSQL |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Auth | JWT (`@elysiajs/jwt`) + Argon2id via `Bun.password` |

---

## Instalasi

### Prasyarat

- [Bun](https://bun.sh) ≥ 1.0
- PostgreSQL

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

# 6. Jalankan server
bun run dev
```

Server berjalan di **`http://localhost:3000`**.

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
├── routes/
│   ├── auth.routes.ts
│   ├── resources.routes.ts
│   └── bookings.routes.ts
├── utils/
│   └── errors.ts          # Custom error classes
└── index.ts               # Entry point
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

## Scripts

| Command | Keterangan |
|---|---|
| `bun run dev` | Jalankan development server dengan hot-reload |
| `bun run start` | Jalankan server production |
| `bun run db:generate` | Generate file migrasi dari schema |
| `bun run db:migrate` | Apply semua migrasi ke database |
| `bun run db:seed` | Isi data awal |
| `bun run db:studio` | Buka Drizzle Studio |
