-- Jalankan file ini SETELAH migrasi drizzle-kit dasar (tabel users/resources/bookings sudah ada).
-- Ini adalah lapisan proteksi di level database untuk mencegah dua booking yang overlap
-- pada resource yang sama, terlepas dari bug apa pun yang mungkin ada di application logic.

-- 1. Aktifkan extension yang dibutuhkan untuk exclusion constraint pada tipe non-scalar (UUID + range)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Tambahkan exclusion constraint:
--    Tolak insert/update jika ada baris lain dengan resource_id yang sama
--    DAN rentang waktu (start_time, end_time) yang overlap,
--    selama status booking tersebut bukan 'cancelled'.
ALTER TABLE bookings
  ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (status <> 'cancelled');

-- Catatan untuk README/interview:
-- Constraint ini akan melempar error kode "23P01" (exclusion_violation) dari PostgreSQL
-- jika terjadi percobaan insert booking yang overlap. Tangkap error ini di service layer
-- dan ubah jadi response 409 Conflict yang informatif untuk user.
