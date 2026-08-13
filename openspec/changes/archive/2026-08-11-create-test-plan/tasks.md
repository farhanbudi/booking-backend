## 1. Test infrastructure

- [ ] 1.1 Add `test` and `test:watch` scripts to package.json using Bun's built-in test runner, with `tests/setup.ts` as preload
- [ ] 1.2 Create `tests/setup.ts` preload that sets `DATABASE_URL` (from `DATABASE_URL_TEST` or default `booking_test`) and a fixed `JWT_SECRET` before app modules load
- [ ] 1.3 Create `tests/helpers/test-db.ts` with migrate + idempotent exclusion constraint apply, `resetDb()`, and `closeDb()`
- [ ] 1.4 Create `tests/helpers/test-app.ts` that builds the Elysia app for in-process `app.handle()` requests
- [ ] 1.5 Create `tests/helpers/auth.ts` with register/login helpers and admin-user creation that returns bearer tokens

## 2. Unit tests

- [ ] 2.1 Add `tests/unit/auth.service.test.ts` covering register (success, duplicate email), login (success, wrong password), and getUserById
- [ ] 2.2 Add `tests/unit/resources.service.test.ts` covering list (active only, minCapacity filter) and getResourceById (not found)
- [ ] 2.3 Add `tests/unit/bookings.service.test.ts` covering availability (overlap, excludes cancelled), createBooking (start>=end, occupied slot, free slot), and cancelBooking (not found, not-owner forbidden)

## 3. API integration tests

- [ ] 3.1 Add `tests/api/auth.api.test.ts` covering register, login, /me, validation errors, and unauthenticated /auth/me
- [ ] 3.2 Add `tests/api/resources.api.test.ts` covering list/filter, admin create (and non-admin forbidden), update, and delete
- [ ] 3.3 Add `tests/api/bookings.api.test.ts` covering availability, create booking, user history, admin/all guard, cancel, and validation errors

## 4. Concurrency tests

- [ ] 4.1 Add `tests/concurrency/race-condition.test.ts` proving concurrent overlapping bookings produce exactly one success, and non-overlapping concurrent bookings both succeed

## 5. Docs

- [ ] 5.1 Add a "Testing" section to README.md with prerequisites, DB setup, and how to run tests