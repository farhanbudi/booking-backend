import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { bearer } from "@elysiajs/bearer";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: "user" | "admin";
}

// Plugin dasar: pasang JWT + bearer token parser, lalu expose helper `getUser()`
// yang bisa dipakai di route mana pun untuk mengambil user yang sedang login.
export const authPlugin = new Elysia({ name: "auth-plugin" })
  .use(
    jwt({
      name: "jwt",
      secret: process.env.JWT_SECRET!,
    })
  )
  .use(bearer())
  .derive({ as: "global" }, async ({ jwt, bearer }) => {
    return {
      getUser: async (): Promise<JwtPayload> => {
        if (!bearer) {
          throw new UnauthorizedError("Token tidak ditemukan");
        }
        const payload = await jwt.verify(bearer);
        if (!payload) {
          throw new UnauthorizedError("Token tidak valid atau sudah expired");
        }
        return payload as unknown as JwtPayload;
      },
    };
  });

// Helper tambahan untuk route yang hanya boleh diakses admin.
// Pemakaian: taruh di dalam handler setelah getUser().
export function requireAdmin(user: JwtPayload) {
  if (user.role !== "admin") {
    throw new ForbiddenError("Hanya admin yang boleh mengakses resource ini");
  }
}

export const requireAuth = new Elysia({ name: "require-auth" })
  .use(authPlugin)
  .resolve({ as: "global" }, async ({ getUser }) => {
    const payload = await getUser();
    return { currentUser: payload };
  });
