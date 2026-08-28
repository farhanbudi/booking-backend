import { Elysia, t } from "elysia";
import { defaultStripePort } from "../modules/payments/stripe.port";
import {
  handleCheckoutCompleted,
  handleCheckoutExpired,
} from "../modules/payments/payments.service";

// Webhook publik TANPA auth middleware (design D3): Stripe yang memanggil.
// Stripe menghitung signature atas RAW body. Elysia secara default mem-parsing
// body JSON menjadi object sebelum handler berjalan, sehingga `request.text()`
// sudah kosong dan verifikasi signature selalu gagal.
//
// Solusi: tangkap teks mentah SEKALI di hook `onParse` (berjalan sebelum parse
// default Elysia mengkonsumsi stream). Hasilnya diletakkan sebagai `body` (string
// persis seperti dikirim Stripe), lalu divalidasi `t.String()`. Dengan ini
// `constructWebhookEvent` menerima byte persis sama dengan yang ditandatangani.
export const paymentRoutes = new Elysia()
  .onParse(async ({ request }) => {
    // Untuk instance ini hanya ada route webhook; kembalikan raw text apa adanya.
    return await request.text();
  })
  .post(
    "/payments/webhook",
    async ({ body, request }) => {
      const rawBody = body as string;
      const signature = request.headers.get("stripe-signature") ?? "";
      const event = await defaultStripePort.constructWebhookEvent(rawBody, signature);

      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(event.data.object);
          break;
        case "checkout.session.expired":
          await handleCheckoutExpired(event.data.object);
          break;
        default:
          // Jenis event lain cukup di-ack 2xx tanpa diproses.
          break;
      }

      return { received: true };
    },
    {
      body: t.String(),
    }
  );
