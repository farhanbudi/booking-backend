import { AppError } from "../../utils/errors";

// Konfigurasi pembayaran (design D8). Semua bernilai default supaya alur
// resource gratis tetap jalan tanpa variabel pembayaran di .env.

export function getPaymentCurrency(): string {
  return (process.env.PAYMENT_CURRENCY ?? "idr").toLowerCase();
}

export function getPaymentExpiryMs(): number {
  const minutes = Number(process.env.PAYMENT_EXPIRY_MINUTES ?? 15);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 15 * 60 * 1000;
  }
  return minutes * 60 * 1000;
}

export function getPaymentSuccessUrl(): string {
  return (
    process.env.PAYMENT_SUCCESS_URL ?? "http://localhost:5173/payments/success"
  );
}

export function getPaymentCancelUrl(): string {
  return (
    process.env.PAYMENT_CANCEL_URL ?? "http://localhost:5173/payments/cancel"
  );
}

// Webhook butuh secret untuk verifikasi signature. Belum di-set => layanan
// pembayaran belum siap menerima event (respons 503).
export function requireWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError(
      "Webhook pembayaran belum dikonfigurasi: STRIPE_WEBHOOK_SECRET belum di-set",
      503
    );
  }
  return secret;
}
