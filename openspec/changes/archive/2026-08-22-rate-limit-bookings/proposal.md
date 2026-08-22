## Why

Endpoint `POST /bookings` saat ini tidak memiliki pembatas frekuensi. Frontend (misal tombol "Booking" yang bisa diklik berulang, atau request yang dikirim ulang saat jaringan lambat) dapat memicu banyak request dalam waktu singkat. Selain memboroskan resource, ini memungkinkan spam dan double-submit dari satu akun. Meski overlap sudah dicegah di database, beban request yang tidak perlu tetap tercipta dan sebaiknya dihentikan lebih awal.

## What Changes

- Tambahkan rate limiting pada `POST /bookings` yang membatasi **10 request per 60 detik** untuk setiap kombinasi **user terautentikasi (JWT `sub`) + alamat IP**.
- Counter disimpan di memory proses (struktur `Map`), **tanpa dependency baru**.
- Bila batas terlampaui, kembalikan `429 Too Many Requests` dengan pesan berbahasa Indonesia.
- Tambahkan header respons `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, dan `Retry-After` agar frontend dapat menangani double-submit dengan lebih baik.
- Tambahkan kelas error `TooManyRequestsError` (status 429) di `src/utils/errors.ts`; sudah otomatis ditangani oleh global error handler di `src/index.ts`.

## Capabilities

### New Capabilities

- `booking-rate-limit`: Pembatasan frekuensi request pada `POST /bookings` per kombinasi user + IP untuk mencegah spam dan double-submit dari frontend.

### Modified Capabilities

- (kosong — tidak ada perubahan requirement pada kemampuan yang sudah ada)

## Impact

- **Kode**: file baru `src/middleware/rate-limit.middleware.ts`; modifikasi `src/routes/bookings.routes.ts` (pasang plugin pada grup booking, hanya berlaku untuk `POST`); modifikasi `src/utils/errors.ts` (tambah `TooManyRequestsError`).
- **API**: respons baru `429` pada `POST /bookings` saat melewati batas; header `X-RateLimit-*` / `Retry-After` pada respons `POST /bookings`. Endpoint lain tidak terpengaruh.
- **Dependencies**: tidak ada dependency baru (in-memory, single instance).
- **Systems**: hanya berlaku untuk instance tunggal (Bun single process). Counter tidak dibagikan antar proses dan akan reset saat proses restart.
