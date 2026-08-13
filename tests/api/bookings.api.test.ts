import { describe, expect, test, beforeAll } from "bun:test";
import { buildApp, requestJson } from "../helpers/test-app";
import { resetDb } from "../helpers/test-db";
import { registerUser, createAdminUser } from "../helpers/auth";

beforeAll(async () => {
  await resetDb();
});

describe("bookings API", () => {
  test("cek availability mengembalikan slot yang sudah terisi", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin Avail", "admin-avail@api.com");
    const user = await registerUser("User Avail", "user-avail@api.com");

    const res = await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang Avail", capacity: 4 },
    });
    const resourceId = (res.data as { id: string }).id;

    await requestJson(app, "/bookings", {
      method: "POST",
      token: user.token,
      body: {
        resourceId,
        startTime: "2026-08-11T09:00:00.000Z",
        endTime: "2026-08-11T10:00:00.000Z",
      },
    });

    const availability = await requestJson(
      app,
      `/bookings/availability?resourceId=${resourceId}&date=2026-08-11`,
      { token: user.token }
    );
    expect(availability.status).toBe(200);
    expect((availability.data as { startTime: string }[]).length).toBe(1);
  });

  test("create booking berhasil dan tercatat di history user", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin Create", "admin-create@api.com");
    const user = await registerUser("User Create", "user-create@api.com");

    const res = await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang Create", capacity: 4 },
    });
    const resourceId = (res.data as { id: string }).id;

    const created = await requestJson(app, "/bookings", {
      method: "POST",
      token: user.token,
      body: {
        resourceId,
        startTime: "2026-08-12T09:00:00.000Z",
        endTime: "2026-08-12T10:00:00.000Z",
      },
    });
    expect(created.status).toBe(201);
    expect((created.data as { status: string }).status).toBe("confirmed");

    const history = await requestJson(app, "/bookings", { token: user.token });
    expect(history.status).toBe(200);
    expect((history.data as unknown[]).length).toBe(1);
  });

  test("create booking dengan waktu tidak valid ditolak (400)", async () => {
    const app = buildApp();
    const user = await registerUser("User Invalid", "user-invalid@api.com");

    const res = await requestJson(app, "/bookings", {
      method: "POST",
      token: user.token,
      body: {
        resourceId: "00000000-0000-0000-0000-000000000000",
        startTime: "bukan-tanggal",
        endTime: "2026-08-12T10:00:00.000Z",
      },
    });

    expect(res.status).toBe(400);
  });

  test("GET /bookings/admin/all ditolak untuk non-admin (403)", async () => {
    const app = buildApp();
    const user = await registerUser("User AdminGuard", "user-adminguard@api.com");

    const res = await requestJson(app, "/bookings/admin/all", { token: user.token });

    expect(res.status).toBe(403);
  });

  test("GET /bookings/admin/all berhasil untuk admin", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin All", "admin-all@api.com");

    const res = await requestJson(app, "/bookings/admin/all", { token: admin.token });

    expect(res.status).toBe(200);
  });

  test("cancel booking oleh pemilik berhasil", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin Cancel", "admin-cancel@api.com");
    const user = await registerUser("User Cancel", "user-cancel@api.com");

    const res = await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang Cancel", capacity: 4 },
    });
    const resourceId = (res.data as { id: string }).id;

    const created = await requestJson(app, "/bookings", {
      method: "POST",
      token: user.token,
      body: {
        resourceId,
        startTime: "2026-08-13T09:00:00.000Z",
        endTime: "2026-08-13T10:00:00.000Z",
      },
    });
    const bookingId = (created.data as { id: string }).id;

    const cancelled = await requestJson(app, `/bookings/${bookingId}/cancel`, {
      method: "PATCH",
      token: user.token,
    });
    expect(cancelled.status).toBe(200);
    expect((cancelled.data as { status: string }).status).toBe("cancelled");
  });

  test("cancel booking orang lain oleh non-admin ditolak (403)", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin Cancel2", "admin-cancel2@api.com");
    const pemilik = await registerUser("Pemilik", "pemilik@api.com");
    const orangLain = await registerUser("Orang Lain", "orang-lain@api.com");

    const res = await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang Cancel2", capacity: 4 },
    });
    const resourceId = (res.data as { id: string }).id;

    const created = await requestJson(app, "/bookings", {
      method: "POST",
      token: pemilik.token,
      body: {
        resourceId,
        startTime: "2026-08-14T09:00:00.000Z",
        endTime: "2026-08-14T10:00:00.000Z",
      },
    });
    const bookingId = (created.data as { id: string }).id;

    const cancelled = await requestJson(app, `/bookings/${bookingId}/cancel`, {
      method: "PATCH",
      token: orangLain.token,
    });
    expect(cancelled.status).toBe(403);
  });
});
