## Context

Endpoint `POST /bookings` (di `src/routes/bookings.routes.ts`, grup Elysia `bookingRoutes` berprefix `/bookings`) saat ini tidak dibatasi. Semua route di grup ini membutuhkan auth via `authPlugin` yang men-derive `getUser()` (mengembalikan `JwtPayload` dengan `sub` dan `role`). Error ditangani secara global di `src/index.ts`: setiap `AppError` (dan turunannya) diubah menjadi respons JSON `{ error: message }` dengan `statusCode` masing-masing. Belum ada kelas error untuk status 429.

## Goals / Non-Goals

**Goals:**

- Batasi `POST /bookings` ke 10 request / 60 detik per kombinasi `sub` + IP.
- Kembalikan `429` dengan pesan Indonesia dan header `Retry-After` serta `X-RateLimit-*`.
- Tanpa dependency baru (in-memory, single instance).

**Non-Goals:**

- Tidak menerapkan rate limit pada endpoint lain (`GET`, `PATCH /cancel`, auth).
- Tidak memakai Redis atau penyimpanan terdistribusi.
- Tidak melakukan proteksi brute-force global pada endpoint auth.

## Decisions

1. **Implementasi sebagai Elysia plugin `rateLimitPlugin`** (di `src/middleware/rate-limit.middleware.ts`) yang mendaftarkan hook `onBeforeHandle`. Plugin dipasang pada grup `bookingRoutes`, namun hanya menegakkan limit bila `request.method === "POST"` (satu-satunya `POST` di grup tersebut).
   - *Alternatif ditolak*: hook `beforeHandle` per-route pada opsi `.post(...)`. Plugin grup + filter method dipilih agar konsisten dengan pola `authPlugin` dan mudah diperluas ke route lain.
   - *Alternatif ditolak*: library `@elysiajs/rate-limit` menambah dependency dan default-nya tidak persis kombinasi `sub`+IP; implementasi sendiri lebih transparan untuk portofolio.

2. **Key = `${sub}:${ip}`**. `sub` diambil dari `getUser()` (auth sudah lewat sehingga request terautentikasi). `ip` diambil dari header `x-forwarded-for` (bagian pertama, untuk kasus di balik proxy) dengan fallback ke alamat remote socket bila header tidak ada. Bila `getUser()` gagal, request dilewati (global handler akan mengembalikan 401).

3. **Algoritma sliding window in-memory**: `Map<string, number[]>` yang menyimpan timestamp epoch-ms tiap request per key. Pada setiap request: buang entri yang lebih tua dari 60 detik; bila sisa panjang >= 10 → lempar `TooManyRequestsError` (429); jika tidak, tambahkan timestamp sekarang dan lanjutkan.

4. **Header respons**: pada respons yang diizinkan, setel `X-RateLimit-Limit: 10`, `X-RateLimit-Remaining: 10 - count`, `X-RateLimit-Reset: <epoch detik saat entri terlama expire>`. Pada 429, setel `Retry-After: <detik hingga entri terlama expire>`.

5. **Error baru**: tambahkan `TooManyRequestsError extends AppError` (statusCode 429, pesan `"Terlalu banyak permintaan, coba lagi nanti."`) di `src/utils/errors.ts`. Karena global handler di `index.ts` sudah menangani seluruh `AppError` secara umum, file tersebut tidak perlu diubah.

## Risks / Trade-offs

- [In-memory tidak persisten lintas restart/proses] → Mitigasi: cukup untuk single-instance portofolio; dicatat sebagai batasan di *Impact* proposal. Bila kelak multi-instance, ganti penyimpanan ke Redis.
- [Kombinasi `sub`+IP memungkinkan satu user dengan banyak IP melampaui batas] → Mitigasi: sesuai pilihan user (kombinasi); brute-force lintas IP berada di luar tujuan perubahan ini.
- [`x-forwarded-for` dapat dipalsukan] → Mitigasi: hanya pertahanan ringan terhadap double-submit terautentikasi, bukan pengganti keamanan auth.
