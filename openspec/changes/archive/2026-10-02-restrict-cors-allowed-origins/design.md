## Context

Lihat `proposal.md` untuk motivasi.

Ada dua build Elysia di repo ini dan keduanya memasang CORS secara terpisah:

- `src/server.ts:15` — app produksi, dibangun oleh `startServer()`.
- `tests/helpers/test-app.ts:14` — app in-process untuk test, dibangun ulang tiap pemanggilan (alasannya ada di komentar file: `JWT_SECRET` dibaca saat build time).

Keduanya memanggil `cors()` tanpa opsi, jadi allowlist tidak terkonfigurasi di mana pun dan test tidak pernah menguji perilaku CORS sama sekali.

Konvensi repo yang relevan: konfigurasi dibaca langsung dari `process.env` (Bun auto-load `.env`) tanpa dependency injection, teks domain ditulis dalam bahasa Indonesia, dan modul diimpor secara statis.

## Goals / Non-Goals

**Goals:**
- Satu sumber kebenaran untuk konfigurasi CORS yang dipakai `src/server.ts` dan `tests/helpers/test-app.ts`.
- Env CORS dibaca saat app dibangun, mengikuti pola yang sudah dipakai `JWT_SECRET` di `auth.middleware.ts`, bukan saat modul diimpor, supaya test bisa mengubah env lalu membangun app.
- Pencocokan origin berupa perbandingan string persis terhadap allowlist, bukan wildcard atau pencocokan suffix.
- Daftar origin bisa diubah tanpa menyentuh kode.

**Non-Goals:**
- Tidak membuat generic config system atau validator env terpusat. Cukup satu helper kecil khusus CORS.
- Tidak menambah rate limiting atau proteksi CSRF. CORS bukan mekanisme otorisasi dan tidak dimaksudkan menggantikannya.
- Tidak mengubah auth (Bearer token plus refresh token di body) menjadi cookie-based.
- Tidak menambah `Access-Control-Max-Age` untuk cache preflight; dampaknya kecil dan tidak diminta.

## Decisions

### 1. Allowlist dibaca oleh satu helper, bukan ditulis inline di dua tempat

Buat fungsi kecil yang mengembalikan opsi untuk `cors()` dari `process.env.CORS_ALLOWED_ORIGINS`. `src/server.ts` dan `tests/helpers/test-app.ts` sama-sama memanggil fungsi itu.

**Alternatif:** setiap file memanggil `cors()` dengan opsi sendiri. Ditolak karena aturan parsing jadi duplikat di dua tempat dan test tidak lagi mencerminkan perilaku produksi.

### 2. Callback `origin` sebagai matcher, bukan array string

`@elysiajs/cors` menerima `origin` sebagai string tunggal, `RegExp`, array of string, atau callback berbentuk `(request: Request) => boolean`. Kita pakai callback: ia mengembalikan `true` hanya bila header `Origin` ada di allowlist, dan nilai apa pun selain itu bila tidak. Plugin hanya menulis `Access-Control-Allow-Origin` (menyalin nilai `Origin` dari request) saat callback mengembalikan `true`; selain itu ia hanya menulis `Vary: Origin` dan membiarkan request tetap diproses.

Catatan implementasi: bentuk callbacknya boolean, bukan "kembalikan origin atau null" seperti digagas awalnya — plugin memanggil `origin(request) === true`, jadi mengembalikan string origin akan dianggap penolakan. Perilaku yang dispesifikasikan tetap sama: origin cocok mendapat header allow persis, origin lain tidak mendapat apa pun, dan request tanpa header `Origin` tetap dilayani.

**Alternatif:** `origin: allowedOrigins` berupa array. Ditolak karena perlu dikonversi ke `RegExp`, dan pencocokan regex berisiko false positive, misalnya `https://app.example.com.evil.com` ikut cocok kalau polanya longgar. Callback dengan perbandingan string persis menghindari itu.

### 3. Fallback di dalam helper, tanpa cabang `NODE_ENV`

Bila `CORS_ALLOWED_ORIGINS` kosong setelah parsing, helper memakai daftar tetap `http://localhost:3000`, `http://localhost:5173`, dan `http://localhost:4173`.

Alasan: user memilih satu allowlist yang sama untuk dev dan production, jadi tidak boleh ada jalur kode berbeda antar environment. Dev tetap jalan tanpa setup, tetapi kode dan perilakunya identik dengan production sehingga perbedaan tidak bisa menyelinap ke production.

**Trade-off yang diterima:** production yang lupa mengisi env tidak menjadi terbuka wildcard, hanya terbuka ke localhost, yang tidak berguna sebagai serangan. Risikonya rendah dan tidak berbahaya; untuk production yang salah konfigurasi, pesan startup yang menyebut allowlist aktif membuat masalahnya terlihat lebih cepat.

### 4. Method dan header ditulis eksplisit

`methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]`, `allowedHeaders: ["Accept", "Authorization", "Content-Type"]`, dan `credentials: false` (nilai default, jadi cukup tidak menyetelnya).

Alasan: dengan `cors()` tanpa opsi, plugin mencerminkan apa pun yang diminta preflight. Daftar eksplisit membuat permukaan CORS bisa dibaca langsung dari kode dan mencegah kita diam-diam melonggarkan daftar setiap kali ada endpoint baru.

### 5. Tidak perlu `maxAge`

Preflight tetap di-cache browser sesuai perilaku default plugin. `maxAge` hanya menghemat satu request `OPTIONS` per kombinasi baru, dan tidak sebanding dengan menambah satu opsi konfigurasi lagi di titik ini.

## Risks / Trade-offs

- **Production lupa mengisi `CORS_ALLOWED_ORIGINS` sehingga frontend diblokir** → fallback hanya mengizinkan localhost, jadi gejalanya CORS error total, bukan lubang keamanan. Mitigasi: catatan wajib di `.env.example` dan README, plus log startup yang menampilkan allowlist aktif sehingga salah konfigurasi terlihat saat deploy.
- **Typo di env, misalnya `https//app.example.com` tanpa titik dua, tidak terdeteksi dan diam-diam tidak match** → sengaja tidak menambah validasi URL. Sebagai gantinya, log startup menampilkan allowlist hasil parse.
- **Test helper dan server bisa membaca env berbeda** → keduanya membaca `process.env` saat app dibangun, jadi test yang butuh allowlist tertentu tinggal menyetel env sebelum memanggil `buildApp()`. Tidak ada state global.
- **Origin baru harus ditulis persis** → disengaja, demi mencegah `https://app.example.com.evil.com` lolos.

## Migration Plan

1. Merge perubahan, lalu isi `CORS_ALLOWED_ORIGINS` di environment deploy.
2. Restart service dan periksa log startup yang menampilkan allowlist aktif.
3. Verifikasi dari domain frontend memakai preflight `OPTIONS`.
4. Rollback: kembalikan `CORS_ALLOWED_ORIGINS` ke daftar origin frontend yang sebenarnya, atau revert deploy. Nilai `*` tidak dipakai sebagai jalan rollback.

## Open Questions

_(tidak ada — keputusan yang memengaruhi spec sudah diklarifikasi sebelum desain ini ditulis)_