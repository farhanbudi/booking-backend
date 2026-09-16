import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { buildApp, requestJson } from "../helpers/test-app";
import { db } from "../../src/db/client";
import { users, sessions } from "../../src/db/schema";
import { eq } from "drizzle-orm";

const TEST_USER = {
  name: "Integration Test User",
  email: `integration-test-${Date.now()}@example.com`,
  password: "password123",
};

const TEST_USER_ID = "22222222-2222-2222-2222-222222222222";

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  await db.delete(sessions);
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({
    id: TEST_USER_ID,
    name: TEST_USER.name,
    email: TEST_USER.email,
    passwordHash: await Bun.password.hash(TEST_USER.password),
    role: "user",
  });

  app = buildApp();
});

beforeEach(async () => {
  await db.delete(sessions);
});

async function login() {
  return requestJson(app, "/auth/login", {
    method: "POST",
    body: { email: TEST_USER.email, password: TEST_USER.password },
  });
}

describe("Auth refresh integration", () => {
  it("login returns accessToken + refreshToken + token alias", async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("accessToken");
    expect(res.data).toHaveProperty("refreshToken");
    expect(res.data).toHaveProperty("token");
    expect((res.data as any).token).toBe((res.data as any).accessToken);
    expect(typeof (res.data as any).accessToken).toBe("string");
    expect(typeof (res.data as any).refreshToken).toBe("string");
    expect((res.data as any).accessToken.length).toBeGreaterThan(0);
    expect((res.data as any).refreshToken.length).toBe(43);
  });

  it("access token works on protected route (/auth/me)", async () => {
    const { data: loginData } = await login();
    const accessToken = (loginData as any).accessToken;

    const res = await requestJson(app, "/auth/me", { token: accessToken });

    expect(res.status).toBe(200);
    expect((res.data as any).email).toBe(TEST_USER.email);
  });

  it("refresh with valid token returns new accessToken", async () => {
    const { data: loginData } = await login();
    const refreshToken = (loginData as any).refreshToken;

    const res = await requestJson(app, "/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("accessToken");
    expect(typeof (res.data as any).accessToken).toBe("string");
    expect((res.data as any).accessToken.length).toBeGreaterThan(0);
  });

  it("refresh with invalid token returns 401", async () => {
    const res = await requestJson(app, "/auth/refresh", {
      method: "POST",
      body: { refreshToken: "invalid-token" },
    });

    expect(res.status).toBe(401);
  });

  it("refresh with expired token returns 401", async () => {
    const { data: loginData } = await login();
    const refreshToken = (loginData as any).refreshToken;

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, TEST_USER_ID));

    const res = await requestJson(app, "/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });

    expect(res.status).toBe(401);
  });

  it("refresh with revoked token returns 401", async () => {
    const { data: loginData } = await login();
    const refreshToken = (loginData as any).refreshToken;

    await requestJson(app, "/auth/logout", {
      method: "POST",
      body: { refreshToken },
    });

    const res = await requestJson(app, "/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });

    expect(res.status).toBe(401);
  });

  it("logout revokes token; subsequent refresh fails with 401", async () => {
    const { data: loginData } = await login();
    const refreshToken = (loginData as any).refreshToken;

    const logoutRes = await requestJson(app, "/auth/logout", {
      method: "POST",
      body: { refreshToken },
    });

    expect(logoutRes.status).toBe(200);
    expect((logoutRes.data as any).success).toBe(true);

    const res = await requestJson(app, "/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });

    expect(res.status).toBe(401);
  });

  it("multiple refreshes with same token succeed (no rotation)", async () => {
    const { data: loginData } = await login();
    const refreshToken = (loginData as any).refreshToken;

    for (let i = 0; i < 3; i++) {
      const res = await requestJson(app, "/auth/refresh", {
        method: "POST",
        body: { refreshToken },
      });

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty("accessToken");
    }
  });

  it("login with invalid credentials returns 401", async () => {
    const res = await requestJson(app, "/auth/login", {
      method: "POST",
      body: { email: TEST_USER.email, password: "wrong-password" },
    });

    expect(res.status).toBe(401);
  });

  it("refresh with missing body returns 400", async () => {
    const res = await requestJson(app, "/auth/refresh", {
      method: "POST",
      body: {},
    });

    expect(res.status).toBe(400);
  });

  it("logout with missing body returns 400", async () => {
    const res = await requestJson(app, "/auth/logout", {
      method: "POST",
      body: {},
    });

    expect(res.status).toBe(400);
  });
});