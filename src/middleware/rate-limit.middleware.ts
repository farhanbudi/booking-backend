import { Elysia } from "elysia";
import { TooManyRequestsError } from "../utils/errors";

export interface RateLimitOptions {
  max?: number;
  windowMs?: number;
}

// Penyimpanan counter di memory proses (satu instance Bun). Counter tidak
// dibagikan antar proses dan reset saat restart — sesuai keputusan desain
// (single-instance). Key = `${sub}:${ip}` (kombinasi user terautentikasi + IP).
const buckets = new Map<string, number[]>();

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// Membangun hook rate-limit yang bisa dipasang via `.onBeforeHandle(...)` maupun
// dibungkus sebagai plugin Elysia. Hanya menegakkan limit bila
// `request.method === "POST"`.
export function rateLimitHook(options: RateLimitOptions = {}) {
  const max = options.max ?? 10;
  const windowMs = options.windowMs ?? 60_000;

  // Param diberi tipe `any` agar bisa dipasang langsung via `.onBeforeHandle()`
  // (Elysia melakukan contextual typing pada callback tersebut). Di dalam fungsi,
  // `request`, `getUser`, dan `set` sudah disediakan oleh context Elysia.
  return async function rateLimit(ctx: any) {
    const { request, getUser, set } = ctx;
    if (request.method !== "POST") return;

    let sub = "anonymous";
    try {
      const user = await getUser();
      sub = user.sub;
    } catch {
      // Request tidak terautentikasi: fallback ke key anonim + IP. Pada route
      // /bookings yang butuh auth, ini praktis tidak terjadi (sudah di-401 duluan).
    }

    const key = `${sub}:${getClientIp(request)}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
    // Buang key yang sudah sepenuhnya kadaluarsa agar memory tidak bocor.
    if (hits.length === 0) buckets.delete(key);
    const oldest = hits[0];

    if (hits.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      set.headers["retry-after"] = String(retryAfter);
      set.headers["x-ratelimit-limit"] = String(max);
      set.headers["x-ratelimit-remaining"] = "0";
      set.headers["x-ratelimit-reset"] = String(Math.ceil((oldest + windowMs) / 1000));
      throw new TooManyRequestsError();
    }

    hits.push(now);
    buckets.set(key, hits);

    const resetTs = oldest !== undefined ? oldest + windowMs : now + windowMs;
    set.headers["x-ratelimit-limit"] = String(max);
    set.headers["x-ratelimit-remaining"] = String(max - hits.length);
    set.headers["x-ratelimit-reset"] = String(Math.ceil(resetTs / 1000));
  };
}

// Plugin Elysia yang membungkus `rateLimitHook`, untuk dipasang pada grup route
// lain bila diperlukan. Pada `bookingRoutes` hook dipasang langsung via
// `.onBeforeHandle()` agar konsisten dengan grup yang sudah ada.
export function rateLimitPlugin(options: RateLimitOptions = {}) {
  return new Elysia({ name: "rate-limit" }).onBeforeHandle(rateLimitHook(options));
}
