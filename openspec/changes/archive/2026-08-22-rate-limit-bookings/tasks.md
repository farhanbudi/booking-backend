## 1. Error & Middleware Foundation

- [x] 1.1 Tambahkan `TooManyRequestsError` (statusCode 429, pesan `"Terlalu banyak permintaan, coba lagi nanti."`) di `src/utils/errors.ts`
- [x] 1.2 Buat `src/middleware/rate-limit.middleware.ts` berisi `rateLimitPlugin` (plugin Elysia dengan hook `onBeforeHandle`) yang mengimplementasikan algoritma sliding-window in-memory (`Map<key, number[]>`), konfigurasi `max = 10`, `windowMs = 60000`, dan hanya aktif untuk `request.method === "POST"`

## 2. Wire Rate Limit ke Route

- [x] 2.1 Pasang `rateLimitPlugin` pada grup `bookingRoutes` di `src/routes/bookings.routes.ts`
- [x] 2.2 Pastikan header `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` disetel pada respons `POST /bookings` yang diizinkan, dan `Retry-After` pada respons 429

## 3. Tests

- [x] 3.1 Tambah test yang memastikan 10 request pertama `POST /bookings` sukses (201) dan request ke-11 dalam 60 detik mendapat `429`
- [x] 3.2 Tambah test bahwa `GET /bookings` dan `GET /bookings/availability` tidak ter-throttle
- [x] 3.3 Tambah test bahwa user berbeda (`sub`/IP berbeda) tidak saling memengaruhi counter

## 4. Validation

- [x] 4.1 Jalankan `bun test`, `bunx tsc --noEmit`, dan `openspec validate` untuk memastikan tidak ada regresi
