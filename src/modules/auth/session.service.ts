import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "../../db/client";
import { sessions } from "../../db/schema";
import { generateRefreshToken, hashToken } from "../../utils/token";
import { UnauthorizedError } from "../../utils/errors";

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);

export async function createSession(input: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const rawToken = generateRefreshToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId: input.userId,
    tokenHash,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
    expiresAt,
  });

  return rawToken;
}

export async function validateSession(rawToken: string) {
  const tokenHash = await hashToken(rawToken);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.tokenHash, tokenHash),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date())
    ),
  });

  if (!session) {
    throw new UnauthorizedError("Refresh token tidak valid atau sudah expired");
  }

  return session;
}

export async function revokeSession(rawToken: string) {
  const tokenHash = await hashToken(rawToken);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}