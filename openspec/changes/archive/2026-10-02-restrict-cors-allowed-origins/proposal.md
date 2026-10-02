## Why

API ini akan dippingakai oleh frontend terpisah di domain sendiri, tapi saat ini `src/server.ts` memasang `.use(cors())` tanpa opsi apa pun, sehingga semua origin diizinkan oleh browser. Setelah deploy ke production, ini berarti domain mana pun bisa memanggil API ini dan membaca responsnya — tidak ada batasan origin sama sekali, dan konfigurasi domain hanya bisa diubah lewat deploy.

## What Changes

- Ganti `cors()` tanpa opsi menjadi konfigurasi berbasis env var `CORS_ALLOWED_ORIGINS` (daftar origin dipisah koma, mis. `https://app.example.com,https://admin.example.com`).
- Origin di luar daftar tidak lagi mendapat header `Access-Control-Allow-Origin`, sehingga browser memblokir respons.
- Auth memakai Bearer token di header dan refresh token di body request — bukan cookie — jadi `Access-Control-Allow-Credentials` tidak diaktifkan, dan `Access-Control-Allow-Origin: *` dipakai hanya bila allowlist memang kosong.
- Fallback: kalau `CORS_ALLOWED_ORIGINS` kosong/unset, daftar origin localhost dev (`http://localhost:3000`, `http://localhost:5173`, `http://localhost:4173`) dipakai, supaya dev tidak perlu setup tambahan.
- **BREAKING** (operasional, bukan kode): deployment production wajib mengisi `CORS_ALLOWED_ORIGINS`. Frontend dengan domain yang tidak terdaftar akan gagal akses sampai env diisi.
- Header/method yang diizinkan dibatasi eksplisit: `GET, POST, PUT, PATCH, DELETE, OPTIONS` dan `Accept, Authorization, Content-Type`.
- Konfigurasi yang sama dipakai oleh app test (`tests/helpers/test-app.ts`) supaya test dan production tidak berbeda perilaku.

## Capabilities

### New Capabilities
- `http-cors`:(origin allowlist berbasis env var untuk API HTTP, termasuk perilaku origin tak dikenal, fallback dev, dan cakupan method/header)

### Modified Capabilities
_(kosong — tidak ada requirement spec existing yang berubah)_

## Impact

- `src/server.ts` — plugin `cors()` sekarang menerima opsi dari env.
- `tests/helpers/test-app.ts` — perlu memakai helper konfigurasi CORS yang sama.
- Modul baru kecil untuk membaca/memvalidasi env CORS (bukan generic config system baru).
- `.env.example` — menambah `CORS_ALLOWED_ORIGINS`.
- `README.md` — catatan deploy bahwa production wajib mengisi env ini.
- `@elysiajs/cors` sudah terpasang; tidak ada dependency baru.