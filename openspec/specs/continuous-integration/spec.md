# continuous-integration Specification

## Purpose

Menjaga kualitas kode `booking-backend` secara otomatis: memastikan setiap pull request dan setiap push ke `main` menjalankan typecheck dan test suite penuh terhadap PostgreSQL sungguhan sebelum boleh digabung, tanpa bergantung pada ingatan developer.

## Requirements

### Requirement: Pipeline berjalan pada setiap pull request dan push ke main

Sistem SHALL menjalankan pipeline CI pada setiap event `pull_request` (terhadap branch apa pun) dan setiap event `push` ke branch `main`. Pipeline SHALL dideklarasikan sebagai satu file workflow tunggal di `.github/workflows/ci.yml` agar tidak ada duplikasi pipeline.

#### Scenario: Pull request dibuka atau diperbarui

- **WHEN** developer membuka pull request baru, atau mendorong commit baru ke branch pull request yang sudah ada
- **THEN** pipeline CI ter-trigger dan job `backend` berjalan
- **AND** job agregat `ci-success` melaporkan hasil akhir pipeline tersebut

#### Scenario: Push langsung ke main

- **WHEN** commit mendorong langsung ke branch `main`
- **THEN** pipeline CI ter-trigger dengan konfigurasi yang sama persis seperti pada pull request

#### Scenario: Push ke branch selain main

- **WHEN** developer mendorong commit ke branch feature yang bukan `main` dan bukan sumber pull request
- **THEN** pipeline CI tidak ter-trigger untuk branch tersebut

### Requirement: Typecheck adalah quality gate

Sistem SHALL menjalankan pemeriksaan tipe TypeScript terhadap seluruh source dan seluruh file test sebagai langkah wajib sebelum test suite dijalankan. Pemeriksaan tipe SHALL dapat dipicu sebagai satu perintah npm script bernama `typecheck`. Kegagalan pemeriksaan tipe SHALL menggagalkan pipeline.

#### Scenario: Type error diperkenalkan

- **WHEN** perubahan memperkenalkan file di `src/` atau `tests/` yang tidak lolos pemeriksaan tipe
- **THEN** langkah `typecheck` keluar dengan status bukan nol
- **AND** job `backend` berstatus gagal

#### Scenario: Typecheck lulus

- **WHEN** tidak ada type error di `src/` maupun `tests/`
- **THEN** langkah `typecheck` keluar dengan status nol dan langkah berikutnya (test) dijalankan

#### Scenario: Cakupan typecheck

- **WHEN** pemeriksaan tipe dijalankan
- **THEN** file di `src/` maupun `tests/` sama-sama diperiksa, dan tidak ada file di kedua direktori tersebut yang dikecualikan dari pemeriksaan

### Requirement: Test suite berjalan terhadap PostgreSQL asli

Sistem SHALL menjalankan test suite lengkap yang sudah ada di repo (seluruh unit, api, integration, dan concurrency test) tanpa mengurangi, melewati, atau melemahkan test mana pun. Test suite SHALL dieksekusi terhadap instance PostgreSQL sungguhan yang dibuat otomatis oleh runner, bukan database lokal developer. Test suite juga SHALL dieksekusi terhadap instance Redis sungguhan, karena sebagian test menjalankan enqueue BullMQ tanpa mock.

#### Scenario: Test membutuhkan database

- **WHEN** pipeline menjalankan langkah `test`
- **THEN** instance PostgreSQL sudah siap dan dapat diakses sebelum test dieksekusi
- **AND** seluruh file test yang ada dijalankan, termasuk test yang memverifikasi exclusion constraint dan race condition

#### Scenario: Test membutuhkan Redis

- **WHEN** pipeline menjalankan langkah `test`
- **THEN** instance Redis sudah siap dan dapat diakses sebelum test dieksekusi
- **AND** antrean BullMQ pada test yang tidak melakukan mock producer benar-benar menerima job, bukan menggantung karena Redis tidak tersedia

#### Scenario: Exclusion constraint diverifikasi

- **WHEN** test concurrency dijalankan terhadap instance PostgreSQL CI
- **THEN** extension `btree_gist` aktif dan constraint `no_overlapping_bookings` terpasang pada tabel `bookings`, sehingga verifikasi overlap benar-benar menguji perilaku database dan bukan sekadar logika aplikasi

#### Scenario: Kegagalan test

- **WHEN** salah satu test gagal
- **THEN** langkah `test` keluar dengan status bukan nol dan job `backend` berstatus gagal
- **AND** job agregat `ci-success` juga berstatus gagal

### Requirement: Isolasi database dan kredensial di CI

Sistem SHALL menjalankan test terhadap database yang terpisah dari database lokal developer, dan database tersebut SHALL diberi nama yang menandainya secara jelas sebagai database test. Workflow SHALL menyediakan seluruh konfigurasi environment yang dibutuhkan test dari nilai dummy yang melekat di dalam workflow, dan SHALL NOT bergantung pada secret repository maupun pada berkas `.env` yang diabaikan Git.

#### Scenario: Guard database test aktif

- **WHEN** pipeline menjalankan test
- **THEN** konfigurasi `DATABASE_URL` yang dipakai menunjuk ke database CI yang namanya mengandung penanda `test`
- **AND** konfigurasi tersebut tersedia tanpa developer harus membuat berkas environment lokal lebih dulu

#### Scenario: Tidak ada kredensial produksi yang bocor

- **WHEN** workflow CI dieksekusi
- **THEN** seluruh nilai environment yang dibutuhkan (termasuk `JWT_SECRET`, Stripe, dan mail) berisi nilai dummy
- **AND** tidak ada secret repository yang dibaca, dan tidak ada nilai rahasia nyata yang tersimpan di dalam repository

#### Scenario: Setup lokal tetap tidak terganggu

- **WHEN** developer menjalankan test secara lokal seperti sebelumnya
- **THEN** konfigurasi `.env.test` lokal tetap dipakai apa adanya dan tidak ditimpa oleh nilai dari CI

### Requirement: Pintu masuk tunggal lewat satu status check agregat

Sistem SHALL menyediakan tepat satu status check yang menjadi representasi keseluruhan keberhasilan pipeline. Nama status check yang dilihat branch protection adalah nama tampilan job, yaitu `CI Success` (bukan key job `ci-success`). Status check ini SHALL berstatus gagal jika salah satu job yang bergantung padanya gagal, dibatalkan, atau tidak berhasil diselesaikan.

#### Scenario: Semua job hijau

- **WHEN** seluruh job pipeline selesai dan semuanya berstatus sukses
- **THEN** job `ci-success` berstatus sukses dan branch protection mengizinkan merge

#### Scenario: Salah satu job gagal

- **WHEN** salah satu job pipeline berstatus gagal
- **THEN** job `ci-success` tetap dievaluasi (tidak dilewati) dan berstatus gagal sehingga merge ke `main` diblokir

#### Scenario: Job dibatalkan

- **WHEN** salah satu job pipeline berstatus `cancelled`, misalnya karena ada push baru yang membatalkan eksekusi sebelumnya
- **THEN** job `ci-success` tetap dievaluasi dan tidak boleh berstatus sukses

#### Scenario: Pipeline tidak dapat di-skip

- **WHEN** perubahan hanya menyentuh dokumentasi atau berkas yang tidak relevan dengan build backend
- **THEN** pipeline tetap berjalan dan `ci-success` tetap dilaporkan, sehingga status check yang diwajibkan branch protection tidak pernah menggantung atau ter-skip permanen

### Requirement: Konkurensi dan pembatalan eksekusi

Sistem SHALL mengelompokkan eksekusi pipeline per kombinasi workflow dan ref, dan SHALL membatalkan eksekusi yang sedang berjalan ketika ada run baru untuk kombinasi yang sama **dan event-nya adalah `pull_request`**. Pembatalan ini SHALL tetap menghasilkan evaluasi `ci-success` yang tidak berhasil. Untuk event `push` ke `main`, pembatalan otomatis SHALL dinonaktifkan karena seluruh commit berbagi ref yang sama, sehingga pembatalan akan membuat commit sebelumnya tidak pernah mendapat hasil berhasil.

#### Scenario: Push baru untuk pull request yang sama

- **WHEN** developer mendorong commit kedua ke pull request yang sedang dalam proses CI
- **THEN** eksekusi lama untuk ref tersebut dibatalkan dan digantikan eksekusi baru
- **AND** `ci-success` untuk eksekusi lama tidak dilaporkan sebagai sukses

#### Scenario: Push baru ke branch `main`

- **WHEN** commit baru didorong ke `main` sementara run commit sebelumnya masih berjalan
- **THEN** eksekusi sebelumnya tidak dibatalkan dan tetap pursues hasil yang berhasil
- **AND** setiap commit di `main` memperoleh status check agregat dengan hasil sendiri

### Requirement: Instalasi dependency yang reproducible

Sistem SHALL memasang dependency menggunakan lockfile yang sudah ada di repo, sehingga CI tidak menyelesaikan ulang versi dependency secara bebas. Workflow SHALL mensyaratkan penggunaan action GitHub yang dipin ke versi mayor.

#### Scenario: Lockfile tidak sinkron dengan manifest

- **WHEN** ada perubahan pada `package.json` yang tidak disertai pembaruan lockfile
- **THEN** langkah instalasi dependency gagal dan pipeline berhenti sebelum typecheck maupun test

#### Scenario: Install berhasil

- **WHEN** lockfile konsisten dengan `package.json`
- **THEN** instalasi dependency selesai dan langkah typecheck dimulai

### Requirement: Cakupan langkah lint

Sistem SHALL menjalankan langkah `lint` hanya jika repo sudah memiliki linter yang terkonfigurasi. Bila repo tidak memiliki konfigurasi linter, sistem SHALL tidak menambahkan langkah lint dan tidak memasang linter baru.

#### Scenario: Repo tanpa linter

- **WHEN** pipeline berjalan pada repo yang tidak memiliki konfigurasi ESLint, Biome, atau Prettier
- **THEN** tidak ada langkah lint yang dijalankan
- **AND** tidak ada dependensi linter baru yang ditambahkan ke `package.json`

#### Scenario: Linter ditambahkan nanti

- **WHEN** suatu saat repo kemudian dikonfigurasi dengan sebuah linter beserta script `lint`
- **THEN** langkah lint dipanggil oleh pipeline hanya pada langkah yang script-nya memang ada di `package.json`

### Requirement: Langkah build hanya bila proses build benar-benar ada

Sistem SHALL hanya menjalankan langkah `build` jika repo benar-benar punya proses build. Untuk repo yang dijalankan langsung dari TypeScript oleh runtime tanpa proses build, langkah `build` SHALL tidak ada di dalam pipeline.

#### Scenario: Repo tanpa proses build

- **WHEN** repo dijalankan langsung oleh runtime tanpa kompilasi
- **THEN** pipeline tidak menjalankan langkah build
- **AND** pipeline tidak gagal karena build step yang tidak pernah ada

### Requirement: Konfigurasi deploy di luar cakupan pipeline

Sistem SHALL NOT membuat, mengubah, atau membatalkan konfigurasi deploy apa pun sebagai bagian dari penambahan pipeline CI. Pipeline CI SHALL NOT melakukan deployment. Integrasi deploy yang sudah berjalan melalui integrasi Git milik platform hosting SHALL tetap bekerja tanpa perubahan.

#### Scenario: Merge ke main memicu deploy

- **WHEN** pipeline `ci-success` berhasil dan merge ke `main` terjadi
- **THEN** mekanisme deploy yang sudah ada pada platform hosting tetap berjalan seperti sebelumnya, tanpa berkas atau kredensial baru di dalam repo

#### Scenario: Tidak ada berkas deploy baru

- **WHEN** perubahan ini diterapkan
- **THEN** tidak ada workflow deployment terpisah yang ditambahkan
- **AND** tidak ada secret deploy yang disimpan di dalam repository
