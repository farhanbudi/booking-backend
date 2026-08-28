import { describe, expect, test, mock } from "bun:test";

// Mock SDK-level constructEvent? Tidak — kita uji port ASLI terhadap env:
// secret belum di-set → 503; secret di-set tapi signature salah → 400.

const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const { defaultStripePort } = await import(
  "../../src/modules/payments/stripe.port"
);

describe("Verifikasi signature webhook (stripe.port)", () => {
  // Bun's expect().rejects can hang for async rejections; use manual try/catch.
  async function statusDari(fn: () => unknown): Promise<number> {
    try {
      await fn();
    } catch (e) {
      return (e as { statusCode?: number }).statusCode ?? -1;
    }
    return -1;
  }

  test("STRIPE_WEBHOOK_SECRET belum di-set → AppError 503 sebelum cek signature", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      expect(
        await statusDari(() =>
          defaultStripePort.constructWebhookEvent('{"id":"evt_1"}', "t=1,v1=abc")
        )
      ).toBe(503);
    } finally {
      if (ORIGINAL_SECRET !== undefined) {
        process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
      }
    }
  });

  test("signature salah/kosong → AppError 400 tanpa efek state", async () => {
    process.env.STRIPE_WEBHOOK_SECRET =
      process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test_local_only";
    try {
      expect(
        await statusDari(() =>
          defaultStripePort.constructWebhookEvent(
            JSON.stringify({ id: "evt_2", type: "checkout.session.completed" }),
            "t=1,v1=signature palsu"
          )
        )
      ).toBe(400);
    } finally {
      if (ORIGINAL_SECRET === undefined) {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    }
  });
});
