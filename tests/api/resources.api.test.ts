import { describe, expect, test, beforeAll } from "bun:test";
import { buildApp, requestJson } from "../helpers/test-app";
import { resetDb } from "../helpers/test-db";
import { registerUser, createAdminUser } from "../helpers/auth";

beforeAll(async () => {
  await resetDb();
});

describe("resources API", () => {
  test("list resource tanpa filter hanya menampilkan yang aktif", async () => {
    const app = buildApp();
    const user = await registerUser("User List", "user-list@api.com");

    const created = await requestJson(app, "/resources", {
      method: "POST",
      token: (await createAdminUser("Admin List", "admin-list@api.com")).token,
      body: { name: "Ruang List", capacity: 4 },
    });
    expect(created.status).toBe(201);

    const listRes = await requestJson(app, "/resources", { token: user.token });
    expect(listRes.status).toBe(200);
    expect((listRes.data as { name: string }[]).some((r) => r.name === "Ruang List")).toBe(true);
  });

  test("filter minCapacity mengembalikan resource yang memenuhi", async () => {
    const app = buildApp();
    const user = await registerUser("User Filter", "user-filter@api.com");
    const admin = await createAdminUser("Admin Filter", "admin-filter@api.com");

    await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang Kecil", capacity: 2 },
    });
    await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang Besar", capacity: 10 },
    });

    const res = await requestJson(app, "/resources?minCapacity=5", { token: user.token });
    expect(res.status).toBe(200);
    const names = (res.data as { name: string }[]).map((r) => r.name);
    expect(names).toContain("Ruang Besar");
    expect(names).not.toContain("Ruang Kecil");
  });

  test("non-admin ditolak membuat resource (403)", async () => {
    const app = buildApp();
    const user = await registerUser("User Biasa", "user-biasa@api.com");

    const res = await requestJson(app, "/resources", {
      method: "POST",
      token: user.token,
      body: { name: "Tidak Boleh", capacity: 4 },
    });

    expect(res.status).toBe(403);
  });

  test("tanpa token ditolak mengakses endpoint admin (401)", async () => {
    const app = buildApp();
    const res = await requestJson(app, "/resources", {
      method: "POST",
      body: { name: "Tanpa Token", capacity: 4 },
    });

    expect(res.status).toBe(401);
  });

  test("admin dapat membuat, memperbarui, dan menghapus resource", async () => {
    const app = buildApp();
    const admin = await createAdminUser("Admin CRUD", "admin-crud@api.com");

    const created = await requestJson(app, "/resources", {
      method: "POST",
      token: admin.token,
      body: { name: "Ruang CRUD", capacity: 4 },
    });
    expect(created.status).toBe(201);
    const resourceId = (created.data as { id: string }).id;

    const patched = await requestJson(app, `/resources/${resourceId}`, {
      method: "PATCH",
      token: admin.token,
      body: { name: "Ruang CRUD Updated", capacity: 8 },
    });
    expect(patched.status).toBe(200);
    expect((patched.data as { name: string }).name).toBe("Ruang CRUD Updated");

    const deleted = await requestJson(app, `/resources/${resourceId}`, {
      method: "DELETE",
      token: admin.token,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.data as { isActive: boolean }).isActive).toBe(false);
  });
});
