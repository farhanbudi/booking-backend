## 1. Helper konfigurasi CORS

- [x] 1.1 Buat `src/config/cors.ts` yang mengekspor fungsi membaca `process.env.CORS_ALLOWED_ORIGINS`: pecah dengan koma, `trim()` tiap entri, buang entri kosong, dan kembalikan daftar origin. Verifikasi: test unit untuk fungsi parsing lulus untuk kasus `""`, `undefined`, `"https://a.com, ,https://b.com"`, dan nilai dengan spasi di sekitar koma.
- [x] 1.2 Di helper yang sama,Ketika daftar hasil parsing kosong, kembalikan daftar fallback `http://localhost:3000`, `http://localhost:5173`, `http://localhost:4173`. Verifikasi: test unit mengassert daftar fallback dipakai saat env kosong, dan daftar default tidak menimpa env yang terisi.
- [x] 1.3 Tambahkan fungsi yang mengembalikan opsi untuk plugin `cors()`: `origin` berupa callback yang mengembalikan `true` hanya bila header `Origin` ada di allowlist, dan nilai lain (termasuk saat request tidak punya header `Origin`) supaya plugin tidak menulis header allow sama sekali; `methods` `GET/POST/PUT/PATCH/DELETE/OPTIONS`; `allowedHeaders` `Accept/Authorization/Content-Type`; `credentials` tidak disetel. Verifikasi: test unit memanggil fungsi itu dengan dua env berbeda dan callback hasilnya benar untuk origin terdaftar, origin tak terdaftar, dan request tanpa `Origin`.
- [x] 1.4 Pastikan pencocokan berupa perbandingan string persis. Verifikasi: test unit mengassert `https://app.example.com.evil.com` tidak cocok dengan allowlist `https://app.example.com`.

## 2. Pasang helper di kedua build Elysia

- [x] 2.1 Ubah `src/server.ts` agar memakai opsi dari helper, menggantikan `.use(cors())` polos, dan tambahkan log startup yang menampilkan daftar origin aktif. Verifikasi: jalankan server dengan `CORS_ALLOWED_ORIGINS` terisi dan lihat log menampilkan daftar tersebut.
- [x] 2.2 Ubah `tests/helpers/test-app.ts` agar memakai opsi dari helper yang sama. Verifikasi: `bun test` suite yang ada tetap lulus tanpa perubahan assertion.
- [x] 2.3 Pastikan `tests/helpers/test-app.ts` membaca env saat app dibangun, bukan saat modul diimpor, supaya test bisa mengatur `CORS_ALLOWED_ORIGINS` sebelum memanggil `buildApp()`. Verifikasi: test yang menyetel env lalu memanggil `buildApp()` melihat allowlist yang baru disetel.

## 3. Test perilaku CORS

- [x] 3.1 Buat `tests/api/cors.api.test.ts` yang memakai `buildApp()` dan `app.handle()`. Verifikasi: file ada dan test bisa mengeksekusi request dengan header `Origin` yang dikustomisasi.
- [x] 3.2 Test origin terdaftar dari allowlist menerima `Access-Control-Allow-Origin` yang persis sama. Verifikasi: test lulus.
- [x] 3.3 Test origin tak terdaftar tidak menerima header `Access-Control-Allow-Origin`. Verifikasi: test lulus.
- [x] 3.4 Test request tanpa header `Origin` tetap dilayani dengan status normal dan tanpa error. Verifikasi: test lulus.
- [x] 3.5 Test preflight `OPTIONS` dari origin terdaftar mencantumkan method dan header yang diizinkan, dan tidak menyertakan `Access-Control-Allow-Credentials: true`. Verifikasi: test lulus.

## 4. Dokumentasi dan verifikasi akhir

- [x] 4.1 Tambahkan `CORS_ALLOWED_ORIGINS` ke `.env.example` beserta komentar bahwa wajib diisi di production dan formatnya daftar origin dipisah koma. Verifikasi: baris env ada di `.env.example`.
- [x] 4.2 Tambahkan bagian CORS ke `README.md` yang menjelaskan env, fallback localhost, dan langkah mengisi env untuk deploy production. Verifikasi: bagian ada di README.
- [x] 4.3 Jalankan `bun test` penuh dan `bunx tsc --noEmit`. Verifikasi: keduanya lulus tanpa error baru.
- [x] 4.4 Verifikasi manual: jalankan server dengan env terisi, lalu `curl -i -H "Origin: https://app.example.com" http://localhost:3000/health` dan ulangi dengan origin di luar allowlist. Verifikasi: respons pertama memuat `Access-Control-Allow-Origin`, respons kedua tidak.