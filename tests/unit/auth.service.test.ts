import { describe, expect, test, beforeAll } from "bun:test";
import { registerUser, validateLogin, getUserById } from "../../src/modules/auth/auth.service";
import { AppError, ConflictError, UnauthorizedError } from "../../src/utils/errors";
import { resetDb } from "../helpers/test-db";

beforeAll(async () => {
  await resetDb();
});

describe("auth.service", () => {
  test("register user baru berhasil", async () => {
    const user = await registerUser({
      name: "Budi",
      email: "budi@test.com",
      password: "rahasia123",
    });

    expect(user.email).toBe("budi@test.com");
    expect(user.name).toBe("Budi");
    expect(user.role).toBe("user");
  });

  test("register dengan email duplikat menolak dengan ConflictError", async () => {
    await registerUser({
      name: "Siti",
      email: "siti@test.com",
      password: "rahasia123",
    });

    try {
      await registerUser({
        name: "Siti Kedua",
        email: "siti@test.com",
        password: "rahasia123",
      });
      throw new Error("registerUser seharusnya menolak email duplikat");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
    }
  });

  test("login dengan kredensial valid berhasil", async () => {
    await registerUser({
      name: "Andi",
      email: "andi@test.com",
      password: "rahasia123",
    });

    const user = await validateLogin({ email: "andi@test.com", password: "rahasia123" });
    expect(user.email).toBe("andi@test.com");
  });

  test("login dengan password salah menolak dengan UnauthorizedError", async () => {
    await registerUser({
      name: "Citra",
      email: "citra@test.com",
      password: "rahasia123",
    });

    try {
      await validateLogin({ email: "citra@test.com", password: "password-salah" });
      throw new Error("validateLogin seharusnya menolak password salah");
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedError);
    }
  });

  test("getUserById mengembalikan user yang ada", async () => {
    const created = await registerUser({
      name: "Deni",
      email: "deni@test.com",
      password: "rahasia123",
    });

    const user = await getUserById(created.id);
    expect(user.id).toBe(created.id);
  });

  test("getUserById melempar error 404 untuk id yang tidak ada", async () => {
    await expect(getUserById("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
      AppError
    );
  });
});
