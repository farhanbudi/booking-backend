import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { buildApp, requestJson } from "../helpers/test-app";

// Regresi: `POST /payments/webhook` adalah route PUBLIK. Keamanannya berasal dari
// verifikasi signature `whsec_`, bukan dari Bearer token. Route ini didaftarkan di
// root app SETELAH plugin auth, jadi `requireAuth` yang resolve-nya `as: "global"`
// akan ikutgrab route publik ini dan membalas 401 "Token tidak ditemukan".

function payloadStripe(): string {
  // Event yang tidak di-handle service -> branch `default`, cukup 2xx ack.
  return JSON.stringify({
    id: "evt_api_webhook_test",
    object: "event",
    type: "customer.created",
    data: { object: { id: "cus_123" } },
  });
}

describe("payments webhook API", () => {
  test("tanpa Authorization tidak ditolak middleware auth", async () => {
    const app = buildApp();
    const res = await requestJson(app, "/payments/webhook", {
      method: "POST",
      body: { id: "evt_api_webhook_test" },
    });

    // Bukan 401/403: request-nya sampai ke verifikasi signature.
    expect(res.status).toBe(400);
    expect(res.data).toEqual({ error: "Invalid signature" });
  });

  test("signature salah tetap 400 Invalid signature", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=1,v1=signature palsu",
        },
        body: payloadStripe(),
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
  });

  test("signature valid dari raw body di-ack 2xx tanpa diproses", async () => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    expect(secret).toBeTruthy();

    const payload = payloadStripe();
    // WAJIB varian Async: SubtleCryptoProvider (Bun) tidak bisa HMAC sinkron,
    // sama seperti catatan di src/modules/payments/stripe.port.ts.
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: secret as string,
    });

    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": header },
        body: payload,
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  test("route terlindungi tetap 401 tanpa token setelah dipindah scoped", async () => {
    const app = buildApp();
    const bookings = await requestJson(app, "/bookings");
    expect(bookings.status).toBe(401);
    expect(bookings.data).toEqual({ error: "Token tidak ditemukan" });

    const resources = await requestJson(app, "/resources");
    expect(resources.status).toBe(401);
    expect(resources.data).toEqual({ error: "Token tidak ditemukan" });

    const me = await requestJson(app, "/auth/me");
    expect(me.status).toBe(401);
    expect(me.data).toEqual({ error: "Token tidak ditemukan" });
  });
});