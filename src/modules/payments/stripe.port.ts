import Stripe from "stripe";
import { AppError } from "../../utils/errors";
import {
  getPaymentCancelUrl,
  getPaymentSuccessUrl,
  requireWebhookSecret,
} from "./payment-config";

// Port Stripe yang bisa di-inject (mirip pola BookingEmailDeps di jobs/processors)
// supaya unit test tidak perlu menyentuh network sama sekali (design D7).

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
}

export interface CreateCheckoutInput {
  bookingId: string;
  resourceName: string;
  // Amount sudah dalam satuan terkecil currency (lihat pricing.ts).
  amount: number;
  currency: string;
}

export interface StripePort {
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSessionResult>;
  constructWebhookEvent(rawBody: string, signature: string): Promise<Stripe.Event>;
}

let client: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      // Hanya gagal saat alur berbayar benar-benar dijalankan (design D7),
      // agar alur resource gratis dan unit test tetap berjalan tanpa Stripe.
      throw new AppError(
        "Pembayaran belum dikonfigurasi: STRIPE_SECRET_KEY belum di-set",
        500
      );
    }
    if (!key.startsWith("sk_test_") && process.env.NODE_ENV === "production") {
      console.warn(
        "[payments] STRIPE_SECRET_KEY bukan kunci test mode (sk_test_*) padahal NODE_ENV=production — proyek ini hanya untuk simulasi pembayaran!"
      );
    }
    client = new Stripe(key);
  }
  return client;
}

export const defaultStripePort: StripePort = {
  async createCheckoutSession(input) {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: input.bookingId,
      metadata: { bookingId: input.bookingId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.amount,
            product_data: { name: input.resourceName },
          },
        },
      ],
      // Sertakan booking_id di URL agar frontend bisa membacanya dari query
      // setelah Stripe mengalihkan (Stripe menambahkan sendiri ?session_id=...).
      success_url: `${getPaymentSuccessUrl()}?booking_id=${input.bookingId}`,
      cancel_url: `${getPaymentCancelUrl()}?booking_id=${input.bookingId}`,
    });
    return { id: session.id, url: session.url };
  },

  async constructWebhookEvent(rawBody, signature) {
    // Secret dicek dulu: belum di-set => layanan belum siap (503),
    // bukan signature salah (400).
    const secret = requireWebhookSecret();
    try {
      // HARUS async: SubtleCryptoProvider (Bun) hanya mendukung context async,
      // sehingga `constructEvent` sync melempar error. Gunakan constructEventAsync.
      return await getStripeClient().webhooks.constructEventAsync(
        rawBody,
        signature,
        secret
      );
    } catch (err) {
      console.error("[webhook] verifikasi signature gagal:", err);
      throw new AppError("Signature webhook Stripe tidak valid", 400);
    }
  },
};
