import { describe, expect, test, beforeAll } from "bun:test";
import { buildApp, requestJson } from "../helpers/test-app";
import { resetDb } from "../helpers/test-db";

beforeAll(async () => {
  await resetDb();
});

describe("auth API", () => {
  test("register mengembalikan 201 dan data user tanpa password hash", async () => {
    const app = buildApp();
    const res = await requestJson(app, "/auth/register", {
      method: "POST",
      body: { name: "Budi", email: "budi@api.com", password: "rahasia123" },
    });

    expect(res.status).toBe(201);
    const data = res.data as Record<string, unknown>;
    expect(data.email).toBe("budi@api.com");
    expect(data).not.toHaveProperty("passwordHash");
    expect(data).not.toHaveProperty("password");
  });

  test("register dengan email duplikat mengembalikan 409", async () => {
    const app = buildApp();
    await requestJson(app, "/auth/register", {
      method: "POST",
      body: { name: "Siti", email: "siti@api.com", password: "rahasia123" },
    });

    const res = await requestJson(app, "/auth/register", {
      method: "POST",
      body: { name: "Siti Lagi", email: "siti@api.com", password: "rahasia123" },
    });

    expect(res.status).toBe(409);
  });

  test("register dengan password pendek mengembalikan 400 (validasi)", async () => {
    const app = buildApp();
    const res = await requestJson(app, "/auth/register", {
      method: "POST",
      body: { name: "Andi", email: "andi@api.com", password: "abc" },
    });

    expect(res.status).toBe(400);
  });

  test("login valid mengembalikan token", async () => {
    const app = buildApp();
    await requestJson(app, "/auth/register", {
      method: "POST",
      body: { name: "Citra", email: "citra@api.com", password: "rahasia123" },
    });

    const res = await requestJson(app, "/auth/login", {
      method: "POST",
      body: { email: "citra@api.com", password: "rahasia123" },
    });

    expect(res.status).toBe(200);
    expect(typeof (res.data as { token: string }).token).toBe("string");
  });

  test("login dengan kredensial salah mengembalikan 401", async () => {
    const app = buildApp();
    const res = await requestJson(app, "/auth/login", {
      method: "POST",
      body: { email: "tidak-ada@api.com", password: "salah" },
    });

    expect(res.status).toBe(401);
  });

  test("/auth/me tanpa token mengembalikan 401", async () => {
    const app = buildApp();
    const res = await requestJson(app, "/auth/me");

    expect(res.status).toBe(401);
  });

  test("/auth/me dengan token mengembalikan profil", async () => {
    const app = buildApp();
    await requestJson(app, "/auth/register", {
      method: "POST",
      body: { name: "Deni", email: "deni@api.com", password: "rahasia123" },
    });
    const loginRes = await requestJson(app, "/auth/login", {
      method: "POST",
      body: { email: "deni@api.com", password: "rahasia123" },
    });
    const token = (loginRes.data as { token: string }).token;

    const res = await requestJson(app, "/auth/me", { token });

    expect(res.status).toBe(200);
    expect((res.data as { email: string }).email).toBe("deni@api.com");
  });
});
