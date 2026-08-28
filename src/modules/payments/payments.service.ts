import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
  bookings,
  payments,
  resources,
  type Booking,
  type Resource,
} from "../../db/schema";
import {
  enqueueConfirmation,
  removeExpiry,
  scheduleReminder,
} from "../../jobs/producers";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { getPaymentCurrency, getPaymentExpiryMs } from "./payment-config";
import { computeAmountInSmallestUnit } from "./pricing";
import { defaultStripePort } from "./stripe.port";

export interface PaymentInfo {
  checkoutUrl: string | null;
  expiresAt: Date;
}

interface CheckoutSessionLike {
  id?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

// Ambil bookingId dari sesi Checkout: utamakan metadata, fallback ke client_reference_id.
function resolveBookingId(session: CheckoutSessionLike): string | null {
  const fromMetadata = session.metadata?.bookingId;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;

  const fromReference = session.client_reference_id;
  if (typeof fromReference === "string" && fromReference) return fromReference;

  return null;
}

async function markPaymentStatus(
  stripeSessionId: string | undefined,
  status: "completed" | "expired"
): Promise<void> {
  if (!stripeSessionId) return;
  await db
    .update(payments)
    .set({ status })
    .where(eq(payments.stripeSessionId, stripeSessionId));
}

async function findBooking(
  bookingId: string
): Promise<{ booking: Booking; resource: Resource } | null> {
  const rows = await db
    .select({ booking: bookings, resource: resources })
    .from(bookings)
    .innerJoin(resources, eq(bookings.resourceId, resources.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return rows[0] ?? null;
}

// Buat Checkout Session untuk booking yang sudah berstatus pending, simpan baris
// payments sebagai riwayat attempt (design D1), lalu kembalikan info pembayaran.
export async function createPendingPayment(
  booking: Booking,
  resource: Resource
): Promise<PaymentInfo> {
  const currency = getPaymentCurrency();
  const pricePerHour = resource.pricePerHour ?? 0;
  const amount = computeAmountInSmallestUnit(
    pricePerHour,
    booking.startTime,
    booking.endTime,
    currency
  );

  const session = await defaultStripePort.createCheckoutSession({
    bookingId: booking.id,
    resourceName: resource.name,
    amount,
    currency,
  });

  await db.insert(payments).values({
    bookingId: booking.id,
    stripeSessionId: session.id,
    amount,
    currency,
    status: "open",
  });

  return {
    checkoutUrl: session.url,
    expiresAt: new Date(Date.now() + getPaymentExpiryMs()),
  };
}

// Gerbang transisi tunggal (design D4): UPDATE kondisional memastikan booking
// pending hanya bisa berpindah status SATU kali, apa pun urutan kedatangan
// webhook / job expiry. Return false artinya ada proses lain yang lebih dulu.
export async function transitionBookingFromPending(
  bookingId: string,
  next: "confirmed" | "cancelled"
): Promise<boolean> {
  const updated = await db
    .update(bookings)
    .set({ status: next })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "pending")))
    .returning({ id: bookings.id });
  return updated.length > 0;
}

// Webhook checkout.session.completed: pending → confirmed + efek samping email.
export async function handleCheckoutCompleted(
  session: CheckoutSessionLike
): Promise<void> {
  const bookingId = resolveBookingId(session);
  if (!bookingId) {
    console.warn(
      "[payments] event checkout.session.completed tanpa referensi booking, diabaikan"
    );
    return;
  }

  const confirmed = await transitionBookingFromPending(bookingId, "confirmed");
  if (!confirmed) {
    // Duplikat event, atau booking sudah dibatalkan expiry — jangan kirim apa pun.
    console.log(
      `[payments] booking ${bookingId} tidak dalam status pending, konfirmasi pembayaran dilewati`
    );
    return;
  }

  try {
    await markPaymentStatus(session.id, "completed");
  } catch (err) {
    console.warn(
      `[payments] gagal menandai payments completed untuk booking ${bookingId}:`,
      err
    );
  }

  try {
    // Job expiry tidak diperlukan lagi karena sudah dibayar.
    await removeExpiry(bookingId);
    // Email konfirmasi + reminder untuk booking berbayar baru diantrekan DI SINI,
    // setelah pembayaran sukses (bukan saat createBooking).
    await enqueueConfirmation(bookingId);
    const found = await findBooking(bookingId);
    if (found) {
      await scheduleReminder(bookingId, found.booking.startTime);
    }
  } catch (err) {
    console.warn(
      `[payments] gagal efek samping pasca-pembayaran booking ${bookingId}:`,
      err
    );
  }
}

// Webhook checkout.session.expired: pending → cancelled.
export async function handleCheckoutExpired(
  session: CheckoutSessionLike
): Promise<void> {
  const bookingId = resolveBookingId(session);
  if (!bookingId) {
    console.warn(
      "[payments] event checkout.session.expired tanpa referensi booking, diabaikan"
    );
    return;
  }

  const cancelled = await transitionBookingFromPending(bookingId, "cancelled");
  if (!cancelled) {
    console.log(
      `[payments] booking ${bookingId} tidak dalam status pending, event expired dilewati`
    );
    return;
  }

  try {
    await markPaymentStatus(session.id, "expired");
  } catch (err) {
    console.warn(
      `[payments] gagal menandai payments expired untuk booking ${bookingId}:`,
      err
    );
  }
}

// Branch processor untuk job delayed `expire-payment`: cancel booking yang masih
// pending lewat TTL. Sengaja TIDAK mengirim email apa pun (spec booking-payments).
export async function expireStalePaymentBooking(bookingId: string): Promise<void> {
  const cancelled = await transitionBookingFromPending(bookingId, "cancelled");
  if (cancelled) {
    console.log(
      `[payments] booking ${bookingId} dibatalkan otomatis karena tidak dibayar sebelum batas waktu`
    );
  } else {
    console.log(
      `[payments] booking ${bookingId} sudah bukan pending, job expiry dilewati`
    );
  }
}

// Retry pembayaran: pemilik booking boleh minta URL checkout segar selama
// booking masih pending (design/proposal: owner retry endpoint).
export async function getFreshCheckoutUrl(
  bookingId: string,
  userId: string
): Promise<{ booking: Booking; payment: PaymentInfo }> {
  const found = await findBooking(bookingId);
  if (!found) {
    throw new NotFoundError("Booking tidak ditemukan");
  }
  if (found.booking.userId !== userId) {
    throw new ForbiddenError(
      "Kamu tidak berhak mengakses pembayaran booking ini"
    );
  }
  if (found.booking.status !== "pending") {
    throw new ConflictError(
      "Booking ini tidak sedang menunggu pembayaran"
    );
  }

  // Selalu buat attempt baru; attempt lama dibiarkan sebagai riwayat.
  const payment = await createPendingPayment(found.booking, found.resource);
  return { booking: found.booking, payment };
}
