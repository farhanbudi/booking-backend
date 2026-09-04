import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../db/schema";
import { AppError, ConflictError, UnauthorizedError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (existing) {
    throw new ConflictError("Email sudah terdaftar");
  }

  // Bun punya built-in password hashing (argon2id secara default) — tidak perlu bcrypt terpisah.
  const passwordHash = await Bun.password.hash(input.password);

  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash,
    })
    .returning();

  return user;
}

export async function validateLogin(input: { email: string; password: string }) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!user) {
    logger.warn({ email: input.email }, "login gagal: email tidak ditemukan");
    throw new UnauthorizedError("Email atau password salah");
  }

  const isValid = await Bun.password.verify(input.password, user.passwordHash);
  if (!isValid) {
    logger.warn({ email: input.email }, "login gagal: password salah");
    throw new UnauthorizedError("Email atau password salah");
  }

  return user;
}

export async function getUserById(id: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) {
    throw new AppError("User tidak ditemukan", 404);
  }
  return user;
}
