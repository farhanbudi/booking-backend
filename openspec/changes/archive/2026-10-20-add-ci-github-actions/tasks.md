## 1. Persiapan branch

- [x] 1.1 Buat dan checkout branch `ci/setup` dari `main` ter-update (`git fetch origin && git checkout -b ci/setup origin/main`). Verifikasi: `git branch --show-current` mengeluarkan `ci/setup`, dan `git status` bersih.
- [x] 1.2 Pastikan `main` tidak tersentuh. Verifikasi: `git log --oneline origin/main -1` tidak berubah selama pengerjaan change ini.

## 2. Package script

- [x] 2.1 Tambahkan script `"typecheck": "tsc --noEmit"` ke `package.json`, tepat di sebelah script `test` yang sudah ada. Verifikasi: `cat package.json` menunjukkan `"typecheck"`, dan script `test` yang sudah ada **tidak berubah byte-nya** (`bun test --timeout=30000 --preload ./tests/setup.ts --parallel=1`).
- [x] 2.2 Pastikan `tsconfig.json` tetap `include: ["src/**/*.ts", "tests/**/*.ts"]` — jangan diubah. Verifikasi: `tsc --showConfig` mencantumkan file di `tests/` pada daftar file yang akan diperiksa.

## 3. Workflow GitHub Actions

- [x] 3.1 Buat `.github/workflows/ci.yml` dengan header: `name: CI`, `on: { pull_request, push: { branches: [main] } }`, `permissions: { contents: read }`, dan blok `concurrency` dengan `group: ${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress: true`. Verifikasi: berkas ter-parse YAML dan keempat blok itu ada.
- [x] 3.2 Tambahkan job `backend` dengan service container `postgres:16` (`POSTGRES_USER`/`POSTGRES_PASSWORD` = `postgres`, `POSTGRES_DB` = `booking_test`, `ports: ["5432:5432"]`, `options: --health-cmd pg_isready ...`). Verifikasi: service postgres memakai image `postgres:16`; opsi healthcheck memakai `pg_isready`.
- [x] 3.3 Tambahkan langkah setup di job `backend`: `actions/checkout@v4`, lalu `oven-sh/setup-bun@v2`. Verifikasi: kedua action dipin ke versi mayor, tidak ada tag commit atau `@main`.
- [x] 3.4 Tambahkan langkah `bun install --frozen-lockfile`. Verifikasi: tidak ada langkah `bun add`, dan `--frozen-lockfile` ada agar lockfile tak sinkron langsung gagal.
- [x] 3.5 Tambahkan blok `env:` di level job berisi nilai dummy untuk seluruh key yang dibutuhkan test suite: `NODE_ENV`, `DATABASE_URL` (menunjuk ke `127.0.0.1:5432/booking_test`), `JWT_SECRET`, `PORT`, `RUN_MODE`, `CORS_ALLOWED_ORIGINS`, `REDIS_URL`, `MAIL_PROVIDER`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_CURRENCY`, `ACCESS_TOKEN_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS`. Verifikasi: tidak ada satu pun nilai rahasia nyata di dalam berkas; `DATABASE_URL` memakai `127.0.0.1` (bukan `localhost`) dan nama database-nya mengandung `test`.
- [x] 3.6 Tambahkan langkah yang membangkitkan `.env.test` di dalam runner dari key yang sama persis dengan blok `env:` job (lihat design.md D1), memakai ekspansi indirek bash (`${!key}`) dan `>> .env.test`. Verifikasi: setelah langkah ini, `cat .env.test` menampilkan seluruh key yang dibutuhkan dan `assertTestDatabaseUrl()` punya bahan untuk menerima `DATABASE_URL`.
- [x] 3.7 Tambahkan langkah `bun run typecheck`. Verifikasi: langkah ada dan berada **sebelum** langkah test.
- [x] 3.8 Tambahkan langkah `bun run test` — memakai script `test` yang sudah ada, tanpa modifikasi flag apa pun. Verifikasi: tidak ada flag tambahan (`--skip`, filter, atau timeout khusus) pada langkah CI.
- [x] 3.9 **Jangan** tambahkan langkah `lint` dan jangan tambahkan langkah `build` — keduanya tidak punya script. Verifikasi: grep `bun run` di `ci.yml` hanya menghasilkan `install`, `typecheck`, dan `test`.
- [x] 3.10 Tambahkan job `ci-success` dengan `needs: [backend]`, `if: always()`, tanpa `container:`, dan satu run step yang `exit 1` bila `needs.backend.result` bukan `success`. Verifikasi: `if: always()` ada (bukan `success()`), dan job tidak memakai `container:`.
- [x] 3.11 Tambahkan service container kedua `redis:7` (`ports: ["6379:6379"]`, `options: --health-cmd "redis-cli ping" ...`) di job `backend`. Alasan (lihat design.md temuan #6–#7 dan D8): test yang tidak mem-`mock.module("../../src/jobs/producers")` — `tests/unit/bookings.service.test.ts`, `tests/api/bookings.api.test.ts`, `tests/api/rate-limit.api.test.ts`, `tests/api/payments-webhook.api.test.ts`, `tests/concurrency/race-condition.test.ts` — menjalankan enqueue BullMQ sungguhan; tanpa Redis `bookingEmailQueue.add()` menggantung (tidak pernah reject, karena `maxRetriesPerRequest: null`) dan test gagal lewat timeout 30 detik. Verifikasi: `REDIS_URL` di blok `env:` job menunjuk ke `127.0.0.1:6379/15` (sudah ada sebelumnya, tidak diubah) dan `ci.yml` ter-parse dengan dua service (`postgres`, `redis`).
- [x] 3.12 Tambahkan `timeout-minutes: 30` di job `backend` (default GitHub adalah 360 menit). Verifikasi: key ada di level job `backend`, dan nilainya di atas durasi run normal (2–4 menit) tapi di bawah default GitHub.
- [x] 3.13 Pin minor Bun di `oven-sh/setup-bun` lewat `with: bun-version: 1.3.x` (lokal 1.3.14). Verifikasi: `bun-version` terbaca sebagai string `1.3.x` (bukan ter-parse jadi angka `1.3`), dan README/lokal tidak menyebut minor lain.
- [x] 3.14 Ubah `cancel-in-progress` jadi `${{ github.event_name == 'pull_request' }}` dan perbarui komentarnya. Verifikasi: ekspresi berisi syarat event, dan komentar menjelaskan kenapa push ke `main` tidak boleh dibatalkan (semua commit berbagi `refs/heads/main`).
- [x] 3.15 Rapikan dua komentar yang salah eja: "ditulis openly" → "ditulis terbuka", "bukan hanya Andal pada env job" → "bukan hanya bergantung pada env job". Verifikasi: `Select-String` untuk `openly` dan `Andal` tidak menemukan apa pun di `ci.yml`.

## 4. Verifikasi lokal

- [x] 4.1 Jalankan `bun install --frozen-lockfile` di repo. Verifikasi: exit 0 dan `git status` tidak menunjukkan perubahan pada `bun.lock`.
- [x] 4.2 Jalankan `bun run typecheck`. Verifikasi: exit 0. Kalau gagal, perbaiki **di source/test** sesuai kasusnya; jangan menambahkan `// @ts-ignore` atau cara lain untuk menonaktifkan typecheck.
- [x] 4.3 Jalankan `bun run test` terhadap PostgreSQL lokal yang sudah ada. Verifikasi: seluruh file test hijau, dan tidak ada test yang di-`skip`/dihapus/dilemahkan. Bandingkan jumlah test sebelum vs sesudah.
- [x] 4.4 Validasi sintaks YAML `ci.yml` (mis. `bunx yaml-lint .github/workflows/ci.yml` atau parse YAML yang setara dengan Bun). Verifikasi: parse sukses tanpa error.
- [x] 4.5 Cross-check setiap perintah yang dipanggil workflow ada sebagai script di `package.json`. Verifikasi: tidak ada perintah workflow yang menunjuk script yang tidak ada.
- [x] 4.6 **Penting:** konfirmasi bahwa langkah `.env.test` + `bun test` di CI tidak bergantung pada `.env.test` lokal developer. Verifikasi: sementara pindahkan `.env.test` lokal ke luar repo, jalankan suite dengan konfigurasi yang meniru CI (env job-level + langkah tulis `.env.test`), pastikan tetap hijau, lalu kembalikan `.env.test` ke tempat semula.
- [x] 4.7 Jalankan `bun run test` dengan Redis hidup (`docker run -d -p 6379:6379 redis:7`) untuk memastikan suite hijau pada kondisi yang meniru CI. Verifikasi: seluruh file test hijau tanpa timeout. Hasil: `169 pass / 0 fail`, 388 `expect()` call, 25 file test, 19,28 detik — jauh di bawah batas `timeout-minutes: 30` dan tanpa satu pun test yang timeout (jadi Redis service di `ci.yml` terbukti cukup). Catatan: suite juga hijau tanpa Redis **hanya** untuk file yang mem-mock producer; tanpa Redis, file yang tidak mem-mock akan menggantung (temuan design.md #6–#7).

## 5. Commit

- [x] 5.1 Commit `package.json` sebagai `chore: add typecheck script`. Verifikasi: `git show --stat HEAD` hanya menyentuh `package.json`.
- [x] 5.2 Commit `.github/workflows/ci.yml` sebagai `ci: add github actions workflow`. Verifikasi: `git show --stat HEAD` hanya menyentuh `.github/workflows/ci.yml`.
- [x] 5.3 Pastikan `git status` bersih dan `main` masih menunjuk ke commit yang sama seperti sebelum perubahan. Verifikasi: `git log --oneline main -1` tidak berubah.

## 6. Laporan akhir (bahasa Indonesia)

- [x] 6.1 Tulis laporan dengan lima bagian: **Temuan repo**, **Perubahan**, **Hasil verifikasi**, **Asumsi & hal yang dilewati**, **Langkah manual untuk saya**. Verifikasi: memuat hasil nyata dari 4.1–4.5, bukan asumsi.
- [x] 6.2 Masukkan daftar asumsi eksplisit: tidak ada linter (lint dilewati, tidak dipasang), tidak ada proses build backend (build dilewati), test suite diasumsikan sudah hijau sebelum perubahan, versi PostgreSQL Render tidak diketahui (diasumsikan major 16), Auto-Deploy Render diasumsikan menyala. Verifikasi: keempat poin ada tertulis.
- [x] 6.3 Masukkan langkah manual: aktifkan branch protection untuk `main` dengan required status check **`CI Success`** (nama tampilan dari field `name:` job, bukan key `ci-success`); konfirmasi Render Auto-Deploy dan Production Branch; tidak ada secret GitHub yang perlu dibuat. Verifikasi: tidak ada satu pun langkah manual yang sebenarnya bisa dikerjakan lewat repo tapi ditulis sebagai langkah manual.
- [x] 6.4 **Jangan push.** Serahkan ke user. Verifikasi: `git status` bersih, branch `ci/setup` punya 2 commit di depan `main`, `git log origin/main..HEAD --oneline` menunjukkan tepat 2 commit.

## 7. Di luar cakupan — jangan dikerjakan

- [x] 7.1 Jangan membuat `.github/workflows/deploy-render.yml`.
- [x] 7.2 Jangan mengubah `render.yaml`, `.env.example`, atau konfigurasi deploy apa pun.
- [x] 7.3 Jangan memasang/mengonfigurasi linter baru, dan jangan menambahkan dependensi apa pun ke `package.json`.
- [x] 7.4 Jangan mengubah kode di `src/**` maupun test di `tests/**` untuk membuat CI hijau.
