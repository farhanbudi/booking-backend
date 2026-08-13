import { describe, expect, test, beforeAll } from "bun:test";
import { buildApp, requestJson } from "../helpers/test-app";
import { resetDb } from "../helpers/test-db";
import { registerUser, createAdminUser } from "../helpers/auth";

// Test ini membuktikan perlindungan double-booking dua lapis (lock aplikasi via
// SELECT ... FOR UPDATE + exclusion constraint di database). Dua request yang
// datang bersamaan untuk slot overlap pada resource yang sama harus menghasilkan
// tepat satu keberhasilan — yang lain gagal dengan 409 Conflict.

beforeAll(async () => {
  await resetDb();
});

async function createResource(app: ReturnType<typeof buildApp>, adminToken: string, name: string) {
  const res = await requestJson(app, "/resources", {
    method: "POST",
    token: adminToken,
    body: { name, capacity: 4 },
  });
  expect(res.status).toBe(201);
  return (res.data as { id: string }).id;
}

async function book(
  app: ReturnType<typeof buildApp>,
  token: string,
  resourceId: string,
  startTime: string,
  endTime: string
) {
  return requestJson(app, "/bookings", {
    method: "POST",
    token,
    body: { resourceId, startTime, endTime },
  });
}

describe("double-booking race condition", () => {
  test("dua booking overlap bersamaan: hanya satu yang berhasil", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin Race", "admin-race@api.com");
    const user = await registerUser("User Race", "user-race@api.com");
    const resourceId = await createResource(app, admin.token, "Ruang Race");

    const [a, b] = await Promise.all([
      book(app, user.token, resourceId, "2026-08-20T09:00:00.000Z", "2026-08-20T10:00:00.000Z"),
      book(app, user.token, resourceId, "2026-08-20T09:30:00.000Z", "2026-08-20T10:30:00.000Z"),
    ]);

    const statuses = [a.status, b.status];
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);
  });

  test("dua booking tidak overlap bersamaan: keduanya berhasil", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin Race2", "admin-race2@api.com");
    const user = await registerUser("User Race2", "user-race2@api.com");
    const resourceId = await createResource(app, admin.token, "Ruang Race2");

    const [a, b] = await Promise.all([
      book(app, user.token, resourceId, "2026-08-21T09:00:00.000Z", "2026-08-21T10:00:00.000Z"),
      book(app, user.token, resourceId, "2026-08-21T11:00:00.000Z", "2026-08-21T12:00:00.000Z"),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });
});
