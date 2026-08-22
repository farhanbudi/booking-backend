import { describe, expect, test, beforeAll } from "bun:test";
import { buildApp, type TestApp } from "../helpers/test-app";
import { resetDb } from "../helpers/test-db";
import { registerUser, createAdminUser, type TestUser } from "../helpers/auth";

beforeAll(async () => {
  await resetDb();
});

let seq = 0;
function email(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@api.com`;
}

function makeReq(
  app: TestApp,
  path: string,
  init: { method?: string; token?: string; body?: unknown; ip?: string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.ip) headers["x-forwarded-for"] = init.ip;

  return app.handle(
    new Request(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  );
}

async function setupResource(app: TestApp, admin: TestUser) {
  const res = await makeReq(app, "/resources", {
    method: "POST",
    token: admin.token,
    body: { name: `RL Room ${seq}`, capacity: 4 },
  });
  return (await res.json()) as { id: string };
}

describe("rate limit pada POST /bookings", () => {
  test("10 request pertama sukses (201) dan ke-11 dalam 60 detik menghasilkan 429", async () => {
    const app = buildApp();
    const admin = await createAdminUser("RL Admin", email("rl-admin"));
    const user = await registerUser("RL User", email("rl-user"));
    const { id: resourceId } = await setupResource(app, admin);

    let successCount = 0;
    let limitedRes: Response | null = null;

    for (let i = 1; i <= 11; i++) {
      const day = String(i).padStart(2, "0");
      const res = await makeReq(app, "/bookings", {
        method: "POST",
        token: user.token,
        body: {
          resourceId,
          startTime: `2026-11-${day}T09:00:00.000Z`,
          endTime: `2026-11-${day}T10:00:00.000Z`,
        },
      });
      if (res.status === 429) limitedRes = res;
      else if (res.status === 201) successCount += 1;
    }

    expect(successCount).toBe(10);
    expect(limitedRes).not.toBeNull();
    // Header sesuai spesifikasi pada respons 429.
    expect(limitedRes!.headers.get("retry-after")).not.toBeNull();
    expect(limitedRes!.headers.get("x-ratelimit-limit")).toBe("10");
    expect(limitedRes!.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(limitedRes!.headers.get("x-ratelimit-reset")).not.toBeNull();
  });

  test("respons POST yang diizinkan menyertakan header X-RateLimit-*", async () => {
    const app = buildApp();
    const admin = await createAdminUser("RL Admin H", email("rl-admin-h"));
    const user = await registerUser("RL User H", email("rl-user-h"));
    const { id: resourceId } = await setupResource(app, admin);

    const res = await makeReq(app, "/bookings", {
      method: "POST",
      token: user.token,
      body: {
        resourceId,
        startTime: "2026-12-01T09:00:00.000Z",
        endTime: "2026-12-01T10:00:00.000Z",
      },
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("9");
    expect(res.headers.get("x-ratelimit-reset")).not.toBeNull();
  });

  test("GET /bookings dan GET /bookings/availability tidak ter-throttle", async () => {
    const app = buildApp();
    const user = await registerUser("RL User G", email("rl-user-g"));

    const availability = await makeReq(
      app,
      `/bookings/availability?resourceId=00000000-0000-0000-0000-000000000000&date=2026-12-01`,
      { token: user.token }
    );
    expect(availability.status).toBe(200);
    // GET tidak boleh membawa header rate limit (hanya POST /bookings).
    expect(availability.headers.get("x-ratelimit-limit")).toBeNull();

    for (let i = 0; i < 15; i++) {
      const list = await makeReq(app, "/bookings", { token: user.token });
      expect(list.status).toBe(200);
    }
  });

  test("user berbeda (sub/IP berbeda) tidak saling memengaruhi counter", async () => {
    const app = buildApp();
    const admin = await createAdminUser("RL Admin D", email("rl-admin-d"));
    const userA = await registerUser("RL User A", email("rl-user-a"));
    const userB = await registerUser("RL User B", email("rl-user-b"));
    const { id: resourceId } = await setupResource(app, admin);

    // userA memenuhi kuota (10 request) pada IP yang sama.
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, "0");
      const res = await makeReq(app, "/bookings", {
        method: "POST",
        token: userA.token,
        ip: "10.0.0.1",
        body: {
          resourceId,
          startTime: `2027-01-${day}T09:00:00.000Z`,
          endTime: `2027-01-${day}T10:00:00.000Z`,
        },
      });
      expect(res.status).toBe(201);
    }

    // userB (sub berbeda) pada IP yang sama tetap diizinkan.
    const resB = await makeReq(app, "/bookings", {
      method: "POST",
      token: userB.token,
      ip: "10.0.0.1",
      body: {
        resourceId,
        startTime: "2027-02-01T09:00:00.000Z",
        endTime: "2027-02-01T10:00:00.000Z",
      },
    });
    expect(resB.status).toBe(201);

    // userA dengan IP berbeda juga tetap diizinkan (key berbeda).
    const resA2 = await makeReq(app, "/bookings", {
      method: "POST",
      token: userA.token,
      ip: "10.0.0.2",
      body: {
        resourceId,
        startTime: "2027-03-01T09:00:00.000Z",
        endTime: "2027-03-01T10:00:00.000Z",
      },
    });
    expect(resA2.status).toBe(201);
  });
});
