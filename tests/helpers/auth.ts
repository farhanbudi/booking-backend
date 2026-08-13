// Helper autentikasi untuk test: mendaftarkan/login user lewat API, dan membuat
// admin langsung ke DB lalu login untuk mendapatkan token (lebih cepat daripada
// seed lewat API). Token yang dipakai dihasilkan oleh endpoint /auth/login yang
// sama dengan runtime, sehingga konsisten dengan JWT_SECRET test.

import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { buildApp, requestJson } from "./test-app";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  token: string;
}

export async function registerUser(
  name = "Test User",
  email = "test@example.com",
  password = "password123"
) {
  const app = buildApp();
  const res = await requestJson(app, "/auth/register", {
    method: "POST",
    body: { name, email, password },
  });

  if (res.status !== 201) {
    throw new Error(`Register gagal: ${res.status} ${JSON.stringify(res.data)}`);
  }

  const user = res.data as { id: string; name: string; email: string; role: "user" | "admin" };
  const token = await login(email, password);
  return { ...user, token } as TestUser;
}

export async function login(email: string, password: string) {
  const app = buildApp();
  const res = await requestJson(app, "/auth/login", {
    method: "POST",
    body: { email, password },
  });

  if (res.status !== 200) {
    throw new Error(`Login gagal: ${res.status} ${JSON.stringify(res.data)}`);
  }

  const { token } = res.data as { token: string };
  return token;
}

// Buat admin langsung di DB lalu dapatkan token lewat login API.
export async function createAdminUser(
  name = "Admin Test",
  email = "admin@test.com",
  password = "adminpassword123"
) {
  const passwordHash = await Bun.password.hash(password);
  const [admin] = await db
    .insert(users)
    .values({ name, email, passwordHash, role: "admin" })
    .returning();

  const token = await login(email, password);
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    token,
  } as TestUser;
}