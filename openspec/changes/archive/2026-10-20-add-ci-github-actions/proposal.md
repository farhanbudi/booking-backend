## Why

Repo ini sudah punya test suite yang cukup matang (~30 file test di `tests/unit`, `tests/api`, `tests/integration`, `tests/concurrency`) beserta `bun test` yang sudah jadi script `test`, tapi **belum ada CI sama sekali** — `.github/` tidak pernah dibuat. Akibatnya quality gate hanya bergantung pada INGATAN developer untuk menjalankan `bun test` dan `tsc --noEmit` sebelum push. Suite test-nya juga berat: butuh PostgreSQL sungguhan (bukan mock) plus extension `btree_gist`, jadi mustahil dijalankan tanpa setup manual.

Proyek ini justru paling butuh otomatisasi di titik itu. Tesis utamanya adalah pencegahan double-booking, dan kebenaran tesis itu tidak dibuktikan logika aplikasi saja — ia dibuktikan exclusion constraint `no_overlapping_bookings` dan transaction `SELECT ... FOR UPDATE` yang sama-sama hidup di dalam database. Test yang memverifikasi 23P01 dan race condition hanya berarti sesuatu kalau benar-benar dieksekusi terhadap PostgreSQL asli di setiap perubahan. Tanpa CI, proteksi yang jadi selling point portfolio bisa rusak diam-diam dan tidak ada yang menyadarinya.

Change ini membuat quality gate otomatis: setiap pull request dan setiap push ke `main` menjalankan typecheck + test di environment yang bersih dan reproducible, dan merge ke `main` diblokir sampai semuanya hijau.

## What Changes

- **Menambahkan satu job CI `backend` dan satu job agregat `ci-success`** di `.github/workflows/ci.yml`, trigger `pull_request` + `push` ke `main`.
- **Menambahkan script `typecheck`** (`tsc --noEmit`) — satu-satunya script baru; script `test` yang sudah ada dipakai ulang apa adanya, tidak diubah.
- **Menyediakan PostgreSQL dan Redis sebagai service container** di runner GitHub Actions, karena seluruh test yang ada membutuhkannya.
- **Menyediakan konfigurasi `.env.test` di CI** dari nilai dummy (dipakai lewat `env:` job-level), karena `tests/setup.ts` memanggil `loadTestEnvFile()` yang melempar error kalau file itu tidak ada, dan `assertTestDatabaseUrl()` mensyaratkan nama database mengandung `test`.
- **Menambahkan allowlist `.env.test.example`** di `.gitignore` supaya daftar env var yang dibutuhkan CI terdokumentasi dan bisa dipakai developer.
- **Menambahkan status check agregat `CI Success`** sebagai satu-satunya gate yang direkomendasikan untuk branch protection `main` (nama tampilan job, bukan key `ci-success`).
- **Tidak mengubah konfigurasi deploy sama sekali.** `render.yaml` tetap apa adanya; tidak ada file workflow deploy baru, tidak ada token/secret baru di repo.
- **Bukan BREAKING**: tidak ada perubahan pada kode aplikasi, kontrak API, atau perilaku runtime. Script `test` yang ada tidak disentuh.

### Non-goals

- Tidak menambahkan linter baru (tidak ada ESLint/Biome/Prettier di repo → `lint` sengaja dilewati, bukan dipasang).
- Tidak menambahkan `build` step (backend Bun tidak punya proses build; `render.yaml` menjalankan `bun run start` langsung).
- Tidak menulis test baru. Test yang sudah ada dipakai 100% apa adanya.
- Tidak ada E2E / Playwright / Cypress.
- Tidak ada `.github/workflows/deploy-render.yml` (Auto-Deploy Render diasumsikan menyala; tidak ada informasi bahwa deploy hook dibutuhkan).
- Tidak menyentuh backend/frontend lain — perubahan ini backend-only, sesuai permintaan.

## Capabilities

### New Capabilities
- `continuous-integration`: jaminan bahwa setiap PR dan setiap push ke `main` menjalankan typecheck + test suite penuh terhadap PostgreSQL ephemeral di GitHub Actions, dan lewat hanya lewat satu status check agregat `ci-success` yang tidak bisa di-skip.

### Modified Capabilities
- (kosong — tidak ada requirement sistem yang berubah; `testing` tetap governs perilaku test suite itu sendiri, `continuous-integration` yang mengaturnya dari sisi pipeline)

## Impact

**File baru:**
- `.github/workflows/ci.yml`

**File diubah:**
- `package.json` — tambah script `typecheck` saja
- `.gitignore` — tambah allowlist `!.env.test.example`

**File tidak disentuh (sengaja):**
- Semua `src/**` — nol perubahan kode aplikasi.-App instance sudah dapat dibangun tanpa membuka port (`tests/helpers/test-app.ts` sudah memakai `buildApp()` + `app.handle()`), jadi tidak perlu refactor sama sekali.
- `tests/**` — nol test baru, nol test yang di-`skip`, nol test yang dilemahkan
- `bunfig.toml`, `tests/setup.ts`, `src/utils/test-env.ts`, `src/db/prepare-test-db.ts`
- `render.yaml`, `.env.example`

**Sistem & dependency:**
- PostgreSQL 16 via `services:` — image resmi sudah menyertakan `btree_gist`, jadi constraint `no_overlapping_bookings` bisa dibuat oleh `prepareDatabase()` tanpa langkah `psql` manual
- Redis 7 via `services:` — test yang tidak mem-`mock.module` `src/jobs/producers` (`tests/unit/bookings.service`, `tests/api/bookings.api`, `tests/api/rate-limit.api`, `tests/api/payments-webhook.api`, `tests/concurrency/race-condition`) menjalankan enqueue BullMQ sungguhan, dan tanpa Redis semuanya hang (bukan error) karena `maxRetriesPerRequest: null`
- Tidak butuh secret GitHub sama sekali — semua nilai env di CI adalah dummy

**Risiko & batasan:**
- Menambah ~2–4 menit latensi PR pertama (cache Bun_INSTALL belum terisi).
- Workflow ini bisa gagal di PR yang membawa regression — itu memang tujuannya.
- Bilangan PostgreSQL di CI harus cocok dengan yang dipakai Render; kalau prod naik versi major, image service ikut naik.
