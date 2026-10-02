## Purpose

Mengatur siapa saja yang boleh memanggil API ini langsung dari browser, memakai daftar origin yang dikonfigurasi lewat environment, sehingga API yang sudah dideploy ke production tidak terbuka untuk domain mana pun.

## ADDED Requirements

### Requirement: Origin allowlist dari environment

Sistem SHALL menentukan daftar origin yang diizinkan dari environment variable `CORS_ALLOWED_ORIGINS`, berisi daftar origin dipisah koma. Setiap entri SHALL diperlakukan sebagai origin eksplisit (scheme + host + port), diproses dengan trimming spasi, dan entri kosong diabaikan. Ketika header `Origin` pada request browser cocok dengan salah satu origin yang diizinkan, respons SHALL menyertakan header `Access-Control-Allow-Origin` berisi origin tersebut. Permintaan tanpa header `Origin` (misalnya `curl`, panggilan server-ke-server, atau test yang tidak mengirim header tersebut) SHALL tetap diproses normal tanpa bergantung pada allowlist.

#### Scenario: Origin terdaftar mendapat header allow

- **WHEN** request browser mengirim header `Origin: https://app.example.com` dan `CORS_ALLOWED_ORIGINS` berisi `https://app.example.com,https://admin.example.com`
- **THEN** respons menyertakan header `Access-Control-Allow-Origin: https://app.example.com`

#### Scenario: Lebih dari satu origin dapat diizinkan

- **WHEN** request mengirim header `Origin: https://admin.example.com` dengan `CORS_ALLOWED_ORIGINS` berisi `https://app.example.com,https://admin.example.com`
- **THEN** respons menyertakan header `Access-Control-Allow-Origin: https://admin.example.com`

#### Scenario: Origin tak terdaftar tidak mendapat header allow

- **WHEN** request mengirim header `Origin: https://penyerang.example.com` dan `CORS_ALLOWED_ORIGINS` hanya berisi `https://app.example.com`
- **THEN** respons tidak menyertakan header `Access-Control-Allow-Origin`

#### Scenario: Spasi dan entri kosong diabaikan

- **WHEN** `CORS_ALLOWED_ORIGINS` bernilai `https://app.example.com, ,https://admin.example.com`
- **THEN** hanya `https://app.example.com` dan `https://admin.example.com` yang diizinkan, dan entri kosong tidak menambah origin apa pun

#### Scenario: Pencocokan bersifat exact

- **WHEN** request mengirim header `Origin: https://app.example.com.evil.com` dan `CORS_ALLOWED_ORIGINS` berisi `https://app.example.com`
- **THEN** respons tidak menyertakan header `Access-Control-Allow-Origin`

#### Scenario: Request tanpa header Origin tetap dilayani

- **WHEN** request dikirim tanpa header `Origin`
- **THEN** request tetap diproses dan mengembalikan status respons normal

### Requirement: Fallback origin development

Ketika `CORS_ALLOWED_ORIGINS` kosong atau tidak diisi, sistem SHALL memakai daftar origin loopback development bawaan: `http://localhost:3000`, `http://localhost:5173`, dan `http://localhost:4173`. Fallback ini berlaku di environment apa pun, bukan hanya saat `NODE_ENV` development, supaya kode dan perilakunya sama di seluruh environment.

#### Scenario: Env kosong memakai origin localhost

- **WHEN** `CORS_ALLOWED_ORIGINS` tidak diisi dan request mengirim header `Origin: http://localhost:5173`
- **THEN** respons menyertakan header `Access-Control-Allow-Origin: http://localhost:5173`

#### Scenario: Env kosong tidak membuka semua origin

- **WHEN** `CORS_ALLOWED_ORIGINS` tidak diisi dan request mengirim header `Origin: https://penyerang.example.com`
- **THEN** respons tidak menyertakan header `Access-Control-Allow-Origin`

### Requirement: Cakupan method dan header

Sistem SHALL membatasi method yang diizinkan ke `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, dan `OPTIONS`. Header request yang diizinkan pada preflight SHALL mencakup `Accept`, `Authorization`, dan `Content-Type`. `Access-Control-Allow-Credentials` SHALL NOT diaktifkan, karena autentikasi memakai Bearer token di header dan refresh token di body request, bukan cookie.

#### Scenario: Preflight untuk request JSON dari origin terdaftar

- **WHEN** browser mengirim preflight `OPTIONS` dengan header `Access-Control-Request-Method: POST` dan `Access-Control-Request-Headers: authorization,content-type` dari origin yang terdaftar
- **THEN** respons mencantumkan method `POST` serta header `authorization` dan `content-type` di dalam `Access-Control-Allow-Methods` dan `Access-Control-Allow-Headers`

#### Scenario: Method di luar daftar tidak diizinkan

- **WHEN** preflight `OPTIONS` meminta method di luar daftar yang diizinkan
- **THEN** method tersebut tidak muncul di `Access-Control-Allow-Methods`

#### Scenario: Credentials tidak diaktifkan

- **WHEN** respons dikirim untuk request dari origin terdaftar
- **THEN** respons tidak menyertakan header `Access-Control-Allow-Credentials` bernilai `true`

### Requirement: Konsistensi konfigurasi dengan app test

App yang dibangun untuk pengujian otomatis SHALL memakai sumber allowlist origin dan aturan parsing yang sama dengan server produksi, sehingga hasil test mencerminkan perilaku CORS yang benar-benar dijalankan di production.

#### Scenario: Test memakai allowlist yang sama

- **WHEN** test membangun app dengan `CORS_ALLOWED_ORIGINS` terisi
- **THEN** app test menerapkan allowlist yang sama dengan server produksi