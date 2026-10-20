## Context

Lihat `proposal.md` untuk motivasi. Bagian ini hanya mencatat kondisi faktual yang membatasi pilihan teknis.

**Layout.** Satu package: `booking-backend`. Tidak ada monorepo, tidak ada sub-frontend. `bun.lock` ada di root, `package.json` ada di root, jadi `working-directory` tidak diperlukan di workflow.

**Tooling yang sudah ada (dipakai ulang, tidak diganti):**

| Script | Status | Catatan |
|---|---|---|
| `test` | ✅ sudah ada | `bun test --timeout=30000 --preload ./tests/setup.ts --parallel=1` — **tidak diubah** |
| `typecheck` | ❌ tidak ada | `tsconfig.json` ada, `noEmit: true`, `include: ["src/**/*.ts", "tests/**/*.ts"]` |
| `lint` | ❌ tidak ada, dan tidak ada linter | Tidak ada ESLint / Biome / Prettier di repo. Sesuai aturan: **SKIP**, jangan pasang. |
| `build` | ❌ tidak ada | Backend Bun menjalankan TS langsung (`render.yaml`: `bun run start`) |

**Batasan lingkungan test yang discovered (ini yang shaping design):**

1. `bunfig.toml` mendaftarkan `preload = ["./tests/setup.ts"]`, dan `tests/setup.ts` memanggil `loadTestEnvFile()` lalu `assertTestDatabaseUrl()` dari `src/utils/test-env.ts`.
2. `loadTestEnvFile()` **melempar error kalau berkas `.env.test` tidak ada** (`readFileSync` di dalam `try/catch` yang melempar). Artinya test suite tidak punya cara jalan tanpa berkas itu ada.
3. `loadTestEnvFile()` menulis `process.env[key] = value` untuk setiap key di `.env.test`. **`.env.test` menang atas `env:` job-level**, karena penulisan eksplisit menimpa apa pun yang sudah ada di environment runner. Ini konsekuensi yang penting: semua env var harus ada **di dalam `.env.test`**, bukan hanya di `env:` job.
4. `assertTestDatabaseUrl()` melempar kalau `DATABASE_URL` kosong atau nama database-nya tidak cocok regex `/test/i`.
5. `prepareDatabase()` di `src/db/prepare-test-db.ts` sudah menangani: buat database kalau belum ada, `CREATE EXTENSION IF NOT EXISTS btree_gist`, jalankan Drizzle `migrate()`, dan pasang constraint `no_overlapping_bookings` secara idempoten. **Artinya langkah manual `psql -f manual_0001_exclusion_constraint.sql` yang ada di `AGENTS.md` TIDAK perlu diulang di CI** — test suite sudah melakukan semuanya sendiri.
6. Test **membutuhkan Redis**, bukan cuma PostgreSQL. `REDIS_URL` memang tidak dibaca langsung oleh `tests/**`, tapi route booking memanggil `bookings.service` yang meng-`await` `enqueueConfirmation` / `scheduleReminder` (booking gratis) atau `payments.service` pada jalur pembayaran, dan fungsi-fungsi itu memakai `bookingEmailQueue` dari `src/queue.ts`. Producer hanya di-`mock.module("../../src/jobs/producers", …)` di 4 file (`tests/unit/bookings-email-jobs`, `bookings-payments`, `payments-expiry`, `payments-webhook`); file lain memanggilnya apa adanya: `tests/unit/bookings.service.test.ts`, `tests/api/bookings.api.test.ts`, `tests/api/rate-limit.api.test.ts`, `tests/api/payments-webhook.api.test.ts`, `tests/concurrency/race-condition.test.ts`.
7. Kalau Redis tidak hidup, gejalanya **bukan** error yang jelas. `src/queue.ts` meng-instantiasi ioredis dengan `maxRetriesPerRequest: null`, jadi `bookingEmailQueue.add()` menunggu koneksi tanpa batas dan tidak pernah reject. `try/catch` di `bookings.service.ts` karena itu tidak menangkap apa pun, dan request menggantung sampai timeout 30 detik. Diverifikasi lewat probe: `add()` ke Redis mati masih menggantung >8 detik dengan `ECONNREFUSED` berulang.
8. Test **tidak butuh jaringan keluar** (internet). `mock.module` dipakai untuk `nodemailer` (`tests/helpers/fake-nodemailer.ts`), `src/jobs/producers` (4 file), dan `src/modules/payments/stripe.port` (2 file). Tidak ada `fetch(` di `tests/**`. Verifikasi webhook Stripe murni komputasi HMAC lokal.
9. `.gitignore` mengabaikan `.env.*` dengan pengecualian hanya `!.env.example`, jadi `.env.test` lokal tidak pernah ikut ter-commit — bagus, tapi juga berarti CI tidak bisa bergantung pada berkas itu dari repo.
10. Image `postgres` resmi sudah menyertakan `btree_gist` (dari paket contrib), jadi extension #5 tidak perlu diinstal manual.
11. App instance sudah bisa dibangun tanpa membuka port: `tests/helpers/test-app.ts` memakai `buildApp()` + `app.handle(new Request(...))`. **Tidak ada refactor kode aplikasi yang diperlukan sama sekali.**

## Goals / Non-Goals

**Goals:**
- Satu workflow, satu aggregate gate (`ci-success`), dua job: `backend` lalu `ci-success`.
- Menjalankan test suite yang **sudah ada** sedekat mungkin dengan cara developer menjalankannya secara lokal: `bun install --frozen-lockfile` → `bun run typecheck` → `bun run test`.
- Nol dependensi baru, nol kode aplikasi yang diubah, nol test yang ditulis/diubah.
- Nol secret GitHub. Semua konfigurasi test berasal dari nilai dummy yang melekat di dalam workflow.

**Non-Goals (lihat juga Out of Scope di spec):**
- Menambah linter atau proses build.
- Mengubah script `test` yang sudah ada.
- Menyentuh `render.yaml`, `.env.example`, atau apa pun yang berkaitan dengan deploy.
- Membuat `.github/workflows/deploy-render.yml`.

## Decisions

### D1 — Bentuk `.env.test` di CI dibangkitkan di dalam workflow, bukan di-commit

**Kendala.** `loadTestEnvFile()` melempar kalau berkasnya tidak ada (keterangan #2), dan isinya menimpa `env:` job-level (keterangan #3). Ada dua cara memenuhi ini:

**Opsi A — commit `.env.test.example`, lalu workflow menyalinnya:**
```yaml
- run: cp .env.test.example .env.test
```
lalu job-level `env:` meng-override `DATABASE_URL` ke service container.

**Opsi B — tulis `.env.test` langsung dari blok `env:` job:**

```yaml
env:
  DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/booking_test
  JWT_SECRET: ci-dummy-jwt-secret-please-rotate
  …
- name: Tulis .env.test dari environment job
  run: |
    {
      echo "NODE_ENV=test"
      for k in DATABASE_URL JWT_SECRET PORT RUN_MODE CORS_ALLOWED_ORIGINS \
               REDIS_URL MAIL_PROVIDER MAIL_FROM SMTP_HOST SMTP_PORT \
               STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET PAYMENT_CURRENCY \
               ACCESS_TOKEN_TTL_MINUTES REFRESH_TOKEN_TTL_DAYS; do
        echo "$k=${!k}" >> .env.test
      done
    } >> .env.test
```
(`${!k}` = indirect expansion bash; GitHub Actions run step memakai bash di ubuntu-latest.)

**Pilihan: B.**

Alasan:
- Single source of truth. Nilai dummy ada **tepat satu** tempat, di blok `env:` job, dan blok itu yang dibaca reviewer workflow sebagai "ini semua yang dibutuhkan test". Opsi Aovalent ada nilai yang ditulis dua kali (sekali di `.env.test.example`, sekali di `env:`), dan yang kedua harus meng-override yang pertama — sumber klasik "kokDiCI.kt different`.
- Opsi A bergantung pada urutan: `cp` harus jalan **sebelum** `bun run test`, dan `env:` baru berlaku kalau `.env.test` meng-override balik. Rapuh.
- Tidak menambah berkas tracked. Change ini tetap 3 file.

Trade-off yang diterima: developer lokal tidak getting templated dari `.env.test.example`. Dikompensasi karena berkas `.env.test` lokal sudah ada dan tidak berubah sama sekali.

Kalau nanti reviewer merasa enumerasi key manual itu rapuh, alternatif yang lebih kokoh adalah mengganti `bun run test` dengan `env $(cat .env.test | xargs) bun test` — **tidak dipakai**, karena cara itu melewati `loadTestEnvFile()` dan menghilangkan guard `assertTestDatabaseUrl()` yang justru ingin dijaga.

### D2 — PostgreSQL sebagai `services:` container, image `postgres:16`

Test butuh DB nyata. Dua pilihan: service container bawaan GitHub Actions, atau spin up Postgres di dalam run step.

**Pilihan: `services:`** dengan snippet:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: booking_test
    ports: ["5432:5432"]
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Alasan: service container punya healthcheck → GitHub **menunggu** sampai siap sebelum menjalankan step, jadi tidak perlu polling loop buatan sendiri. Plus, image resmi sudah ada `btree_gist`, jadi `prepareDatabase()` langsung berhasil tanpa `apt install postgresql-contrib`.

Kenapa `POSTGRES_DB: booking_test` (bukan membiarkan Postgres membuat `postgres`): `createTestDatabase()` di `prepare-test-db.ts` sudah membuat database sendiri kalau belum ada, jadi secara teknis `postgres` polos juga bisa. Tapi `POSTGRES_DB: booking_test` membuat nama yang muncul di `DATABASE_URL` langsung terlihat benar, dan memenuhi requirement #4 tanpa intervensi pihak ketiga apa pun. Sebaliknya, `POSTGRES_DB` hanya dihormati saat inisialisasi pertama volume — tidak seperti `createTestDatabase()` yang eksplisit dan idempoten.

Kenapa `127.0.0.1` bukan `localhost`: pada Linux runner, `localhost` *bisa* dipetakan ke IPv6 `::1`, sedangkan port mapping Docker hanya bind ke IPv4. Kalau `postgres.js` atau driver lain jatuh ke IPv6, koneksi gagal dengan error yang membingungkan. `127.0.0.1` tidak punya ambiguitas itu.

**Alternatif yang ditolak:** menjalankan `service postgresql start` di Ubuntu runner. Lebih cepat, tapi image runner punya versi Postgres yang tidak kita kendalikan dan bisa berbeda dari Render → drift. Versi eksplisit lebih berharga daripada 30 detik.

### D3 — Satu job `backend`, langkah diinjeksi dari daftar script

Job `backend` menjalankan urutan `typecheck` lalu `test`. Tidak ada `lint`, tidak ada `build` — keduanya tidak ada script-nya.

Spesifikasi menuntut "hanya jalankan langkah X kalau script X ada". Untuk repo ini itu selesai secara statis di tangan manusia (hanya `typecheck` + `test`). Alasannya: **jangan** menulis logika `if [[ -f package.json ]] && jq -e '.scripts.lint'` — itu dynamic dispatch yang tidak menambah nilai saat hanya ada dua langkah dan keduanya sudah pasti ada. Kalau nanti repo bertambah, menambahkan `bun run lint` saat script-nya ada adalah perubahan satu baris yang eksplisit, dan reviewing-nya lebih mudah daripada condition yang evaluasinya buram.

### D4 — Bentuk job `ci-success`

```yaml
ci-success:
  if: always()
  needs: [backend]
  runs-on: ubuntu-latest
  steps:
    - run: |
        if [ "${{ needs.backend.result }}" != "success" ]; then
          echo "Job backend: ${{ needs.backend.result }}"
          exit 1
        fi
```

Job tanpa `container:` — sengaja, biar tidak pull image postgres kedua cuma untuk satu baris `if`. Output kosong kalau hijau; kalau merah, exit 1.

`if: always()` wajib dipakai (bukan `if: success()`), karena `success()` di job yang depend-nya gagal berarti job ini akan **di-skip** — persis skenario yang requirement "tidak boleh ter-skip" larang. Karena branch protection diarahkan pada check name **`CI Success`** (nama tampilan dari field `name:` job, bukan key `ci-success`), job yang di-skip akan menggantung PR selamanya.

Satu job di `needs`, jadi ekspresi aggregasinya marcapada `needs.backend.result != "success"`; tetap ditulis per-eksplisit supaya penambahan job di kemudian hari tidak diam-diam lolos.

### D5 — Tanpa cache Bun

Cache tidak dapat di-share antar job, karena `services:` container dan cache(step) berjalan di runner yang berbeda. Karena itu **tidak ada langkah cache sama sekali**. Repo hanya punya satu dependency graph, `bun install` pada cache dingin selesai ~10–20 detik, dan menambahkan key cache yang salah hanya menambah permukaan kegagalan tanpa manfaat nyata. Trade-off ini disengaja: kesederhanaan di atas beberapa detik.

### D6 — Tidak ada `deploy-render.yml`

`render.yaml` sudah ada dan Render punya GitHub integration sendiri. Auto-Deploy diasumsikan menyala. Membuat workflow deploy kedua hanya memunculkan dua jalur yang bisa saling bertentangan. Kalau nanti Auto-Deploy dimatikan, itu change terpisah dengan secret `RENDER_DEPLOY_HOOK`.

### D7 — Branch `ci/setup`, commit terpisah per lapisan

Semua pekerjaan di branch `ci/setup` (bukan `main`). Commit dipisah berdasarkan lapisan supaya diff mudah direview:

1. `chore: add typecheck script` — `package.json`
2. `ci: add github actions workflow` — `.github/workflows/ci.yml`

`.gitignore` allowlist **tidak** jadi commit terpisah karena tidak ada lagi file yang perlu di-allowlist pada perubahan ini (D1GV Callersequently menghilangkan kebutuhan itu). Kalau nanti `.env.test.example` ditambahkan, itu ikut commit 1.

### D8 — Redis juga jadi `services:` container, image `redis:7`

Temuan #6 dan #7 membatalkan asumsi awal bahwa Redis tidak perlu ada di CI. Test yang tidak mem-`mock.module` producer menjalankan enqueue sungguhan, dan karena `maxRetriesPerRequest: null`, kegagalan Redis bermanifestasi sebagai request yang menggantung (bukan error), job `backend` akan merah dengan gejala "test timeout" yang menyesatkan, bukan "layanan tidak tersedia".

```yaml
redis:
  image: redis:7
  ports: ["6379:6379"]
  options: >-
    --health-cmd "redis-cli ping"
    --health-interval 10s
    --health-timeout 5s
    --health-retries 5
```

`REDIS_URL` di blok `env:` job sudah menunjuk ke `127.0.0.1:6379/15` (database 15, terpisah dari Redis lokal developer), jadi penambahan service di atas adalah satu-satunya perubahan yang diperlukan. Alasan memakai service container (bukan spin-up manual) sama dengan D2: healthcheck membuat Actions menunggu sampai siap, tanpa polling loop buatan sendiri.

**Alternatif yang ditolak:** `mock.module("../../src/jobs/producers", …)` di kelima file yang tersisa. Itu membuat CI bebas Redis dan sesuai niat desain awal, tapi menyentuh test (bertentangan dengan tujuan "nol test diubah"), menambah risiko mock namespace tidak lengkap di salah satu file, dan membuat jalur enqueue di level API tidak teruji sama sekali sehingga test api booking berhenti memverifikasi apa yang benar-benar terjadi di produksi.

### D9 — Batas waktu job, pin minor Bun, dan pembatalan hanya untuk PR

Tiga penyetelan kecil yang muncul dari review terhadap workflow yang sudah jadi:

**`timeout-minutes: 30` di job `backend`.** Tanpa itu GitHub memakai default 360 menit. Run normal selesai 2–4 menit, jadi 30 menit masih muat untuk kasus terburuk ketika banyak test kena timeout 30 detik (`bun test --timeout=30000`) bergantian. Yang membuat batas ini lebih penting daripada sekadar "test yang menggantung": `bun test` bisa menyelesaikan semua test tapi prosesnya tidak exit karena handle ioredis/BullMQ yang masih me-retry menahan event loop (`maxRetriesPerRequest: null`). Job yang test-nya hijau akan tetap menggantung sampai batas job.

**`bun-version: 1.3.x` di `oven-sh/setup-bun`.** Bun lokal saat perubahan ini ditulis adalah 1.3.14. Minor pin dipilih, bukan exact pin: kunci major+minor sehingga `bun.lock` dan `--frozen-lockfile` tidak gagal karena versi berbeda, tapi patch baru tetap masuk tanpa PR manual. Exact pin hanya perlu kalau repo nanti ikut memakai fitur yang stabilize di patch tertentu. Naikkan minor ini manual setiap kali Bun lokal naik.

**`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.** Dulu `true` tanpa syarat. Masalahnya: untuk `push` ke `main`, `github.ref` selalu `refs/heads/main` untuk semua commit, jadi seluruh push ke `main` berbagi satu concurrency group dan commit berikutnya membatalkan run commit sebelumnya — commit lama tidak pernah mendapat hasil sukses (hasilnya `cancelled`, yang dievaluasi `ci-success` sebagai gagal), persis skenario yang dilarang oleh D4. Untuk PR, pembatalan tetap desirable supaya tidak menunggu dua run paralel.

**Nama required check = `CI Success`.** Branch protection mencocokkan nama check run, yaitu field `name:` job, bukan key `ci-success`. Ini hanya relevan untuk langkah manual di tasks.md, tapi salah nama berarti PR menggantung selamanya tanpa error yang jelas.

## Risks / Trade-offs

- **[PostgreSQL version drift dengan Render]** → Render menentukan versi di dashboard. Kalau prod naik ke major berikutnya, image `services:` harus dinaikkan bersamaan; tulis versi eksplisit di `ci.yml` supaya drift terlihat saat review.
- **[Suite test hijau di lokal tapi merah di CI karena data/ordering]** → Test sudah didesain deterministik (`TRUNCATE ... RESTART IDENTITY`) dan `--parallel=1`. Kalau ada yang flaky, failure harus diperbaiki di test-nya, **dilarang** menambah `skip` atau timeout pengecualian di workflow.
- **[Redis tidak tersedia di runner]** → Gejalanya tidak langsung: `bookingEmailQueue.add()` menggantung, bukan error, sehingga test yang memakai Redis gagal lewat timeout 30 detik dan mungkin disalahartikan sebagai bug test. Healthcheck `redis-cli ping` mencegah runner mulai sebelum Redis siap; kalau suatu saat Redis hilang dari workflow, cari dulu test yang memanggil booking tanpa mock producer.
- **[`--parallel=1` membuat CI lambat]** → 30 file test dalam satu proses memang lambat, tapi itu cukup untuk satu repo portfolio. Memecah jadi beberapa job akan mengalikan setup Postgres tanpa coverage tambahan yang nyata.
- **[Drift versi Bun antara CI, lokal, dan Render]** → CI dipin minor lewat `bun-version: 1.3.x`, tapi Render memilih versi Bun-nya sendiri di dashboard dan tidak bisa dipin dari repo. Kalau prod perlu patch tertentu, atur lewat dashboard Render dan catat di README; kalau `bun install` di CI mulai gagal, naikkan minor di `ci.yml` sesuai versi lokal.
- **[Timezone/locale berbeda antara runner dan developer]** → Node/Bun bawaan UTC; tidak ada yang memformat tanggal dengan locale eksplisit di test yang perlu perhatian. Kalau muncul, perbaik di test-nya.
- **[`.env.test` di-overwrite `env:` job]** → IniKenapa D1 memakai eksplisit `NODE_ENV=test` + enumerasi key: justru karena `.env.test` menang, deklarasi key di `env:` bukan no-op, tapi juga berarti key yang **tidak** ditulis ke `.env.test` tidak akan sampai ke `process.env`. Karena itu enum yang sama persis dipakai untuk `env:` dan untuk penulisan berkas.
- **[Branch protection butuh setup manual]** → `CI Success` tidak bisa diaktifkan dari dalam repo. Ada di tasks.md sebagai langkah manual + checklist di laporan akhir. Careful: yang diisikan ke kolom "required status check" adalah `CI Success` (nama tampilan job), bukan key `ci-success`.
- **[Tidak ada lint]** → Repo memang belum punya linter terkonfigurasi; disengaja, mengikuti aturan eksplisit "jangan pasang linter baru". Efeknya: konsistensi format dan kualitas gaya tidak dijaga CI. Dicatat sebagai follow-up.

## Migration Plan

Tidak ada migrasi data, tidak ada backward-compat concern, tidak ada downtime.

Urutan apply:
1. Bikin branch `ci/setup`.
2. Tambah script `typecheck` di `package.json`.
3. Tambah `.github/workflows/ci.yml`.
4. Verifikasi lokal: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`.
5. Commit terpisah (lihat D7).
6. **Jangan push sampai diminta.**
7. Setelah user push + PR merged: aktifkan branch protection di GitHub Settings → Branches (langkah manual).

**Rollback:** `git revert` commit `ci.yml`, atau matikan branch protection rule. Tidak ada efek samping pada runtime aplikasi karena nol perubahan kode aplikasi.

## Open Questions

- Versi PostgreSQL yang sebenarnya dipakai di Render tidak tertulis di `render.yaml` (di luar scope untuk change ini). Kalau ternyata bukan major 16, angka di `ci.yml` perlu disesuaikan. Ini answerable belakangan tanpa mengubah spec atau pendekatan — hanya satu baris.
