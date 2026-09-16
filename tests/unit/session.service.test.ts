import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createSession, validateSession, revokeSession } from "../../src/modules/auth/session.service";
import { db } from "../../src/db/client";
import { sessions, users } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { UnauthorizedError } from "../../src/utils/errors";
import { hashToken } from "../../src/utils/token";

const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

async function expectUnauthorized(fn: () => Promise<unknown>) {
  try {
    await fn();
    throw new Error("Expected UnauthorizedError but did not throw");
  } catch (e) {
    expect(e).toBeInstanceOf(UnauthorizedError);
  }
}

beforeAll(async () => {
  await db.delete(sessions);
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({
    id: TEST_USER_ID,
    name: "Test User",
    email: "test@example.com",
    passwordHash: "hashed",
    role: "user",
  });
});

afterAll(async () => {
  await db.delete(sessions);
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

beforeEach(async () => {
  await db.delete(sessions);
});

describe("session service", () => {
  describe("createSession", () => {
    it("creates a session and returns a plaintext refresh token", async () => {
      const token = await createSession({
        userId: TEST_USER_ID,
        userAgent: "test-agent",
        ipAddress: "127.0.0.1",
      });

      expect(token).toBeTypeOf("string");
      expect(token.length).toBe(43);

      const session = await db.query.sessions.findFirst({
        where: eq(sessions.userId, TEST_USER_ID),
      });
      expect(session).not.toBeNull();
      expect(session!.userAgent).toBe("test-agent");
      expect(session!.ipAddress).toBe("127.0.0.1");
      expect(session!.revokedAt).toBeNull();
      expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("creates session with nullable userAgent and ipAddress", async () => {
      const token = await createSession({
        userId: TEST_USER_ID,
        userAgent: null,
        ipAddress: null,
      });

      expect(token).toBeTypeOf("string");

      const session = await db.query.sessions.findFirst({
        where: eq(sessions.userId, TEST_USER_ID),
      });
      expect(session!.userAgent).toBeNull();
      expect(session!.ipAddress).toBeNull();
    });
  });

  describe("validateSession", () => {
    it("accepts a valid refresh token", async () => {
      const token = await createSession({ userId: TEST_USER_ID });
      const session = await validateSession(token);

      expect(session.userId).toBe(TEST_USER_ID);
      expect(session.revokedAt).toBeNull();
    });

    it("rejects an expired token", async () => {
      const token = await createSession({ userId: TEST_USER_ID });

      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.tokenHash, await hashToken(token)));

      await expectUnauthorized(() => validateSession(token));
    });

    it("rejects a revoked token", async () => {
      const token = await createSession({ userId: TEST_USER_ID });
      await revokeSession(token);

      await expectUnauthorized(() => validateSession(token));
    });

    it("rejects a non-existent token", async () => {
      await expectUnauthorized(() => validateSession("non-existent-token"));
    });
  });

  describe("revokeSession", () => {
    it("marks session as revoked", async () => {
      const token = await createSession({ userId: TEST_USER_ID });
      await revokeSession(token);

      const session = await db.query.sessions.findFirst({
        where: eq(sessions.userId, TEST_USER_ID),
      });
      expect(session!.revokedAt).not.toBeNull();
    });

    it("is idempotent on already-revoked token", async () => {
      const token = await createSession({ userId: TEST_USER_ID });
      await revokeSession(token);
      await revokeSession(token); // should not throw

      const session = await db.query.sessions.findFirst({
        where: eq(sessions.userId, TEST_USER_ID),
      });
      expect(session!.revokedAt).not.toBeNull();
    });
  });
});