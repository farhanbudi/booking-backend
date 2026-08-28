import { describe, expect, test, beforeAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../helpers/test-db";
import { db } from "../../src/db/client";
import { bookings, payments, resources, users } from "../../src/db/schema";

// ===== Mock producers (antrean email & expiry) =====
const panggilan = {
  confirmation: [] as string[],
  cancellation: [] as string[],
  reminderDijadwalkan: [] as Array<{ bookingId: string; startTime: Date }>,
  reminderDihapus: [] as string[],
  expiryDijadwalkan: [] as Array<{ bookingId: string; ttlMs: number }>,
  expiryDihapus: [] as string[],
};

mock.module("../../src/jobs/producers", () => ({
  enqueueConfirmation: async (bookingId: string) => {
    panggilan.confirmation.push(bookingId);
  },
  enqueueCancellation: async (bookingId: string) => {
    panggilan.cancellation.push(bookingId);
  },
  scheduleReminder: async (bookingId: string, startTime: Date) => {
    panggilan.reminderDijadwalkan.push({ bookingId, startTime });
    return true;
  },
  removeReminder: async (bookingId: string) => {
    panggilan.reminderDihapus.push(bookingId);
  },
  scheduleExpiry: async (bookingId: string, ttlMs: number) => {
    panggilan.expiryDijadwalkan.push({ bookingId, ttlMs });
  },
  removeExpiry: async (bookingId: string) => {
    panggilan.expiryDihapus.push(bookingId);
  },
}));

const { handleCheckoutCompleted, handleCheckoutExpired } = await import(
  "../../src/modules/payments/payments.service"
);

async function seedPendingBooking(opts?: {
  status?: "pending" | "confirmed" | "cancelled";
}): Promise<{ bookingId: string; userId: string }> {
  const [user] = await db
    .insert(users)
    .values({
      name: `User ${Math.random()}`,
      email: `webhook-${Math.random()}@test.com`,
      passwordHash: "x",
    })
    .returning();
  const [resource] = await db
    .insert(resources)
    .values({ name: `Ruang Webhook ${Math.random()}`, pricePerHour: 15000 })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2027-02-10T02:00:00.000Z"),
      endTime: new Date("2027-02-10T03:00:00.000Z"),
      status: opts?.status ?? "pending",
    })
    .returning();
  return { bookingId: booking.id, userId: user.id };
}

beforeAll(async () => {
  await resetDb();
});

describe("Handler webhook Stripe (idempoten via gerbang kondisional)", () => {
  test("checkout.session.completed mengonfirmasi booking pending + efek samping email sekali", async () => {
    const { bookingId } = await seedPendingBooking();

    await handleCheckoutCompleted({
      id: `cs_${bookingId}`,
      metadata: { bookingId },
    });

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row.status).toBe("confirmed");
    expect(panggilan.confirmation).toContain(bookingId);
    expect(panggilan.expiryDihapus).toContain(bookingId);
    expect(panggilan.reminderDijadwalkan.length).toBe(1);
  });

  test("delivery duplikat adalah no-op (tanpa email kedua)", async () => {
    const { bookingId } = await seedPendingBooking();
    const session = { id: `cs_${bookingId}`, metadata: { bookingId } };

    await handleCheckoutCompleted(session);
    panggilan.confirmation.length = 0;
    panggilan.reminderDijadwalkan.length = 0;

    await handleCheckoutCompleted(session); // duplikat

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row.status).toBe("confirmed");
    expect(panggilan.confirmation.length).toBe(0);
    expect(panggilan.reminderDijadwalkan.length).toBe(0);
  });

  test("event completed untuk booking yang sudah cancelled adalah no-op", async () => {
    const { bookingId } = await seedPendingBooking({ status: "cancelled" });
    panggilan.confirmation.length = 0;

    await handleCheckoutCompleted({
      id: `cs_${bookingId}`,
      metadata: { bookingId },
    });

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row.status).toBe("cancelled");
    expect(panggilan.confirmation.length).toBe(0);
  });

  test("checkout.session.expired membatalkan booking pending tanpa email", async () => {
    const { bookingId } = await seedPendingBooking();
    panggilan.cancellation.length = 0;
    panggilan.confirmation.length = 0;

    await handleCheckoutExpired({
      id: `cs_exp_${bookingId}`,
      metadata: { bookingId },
    });

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row.status).toBe("cancelled");
    // Expiry TIDAK mengirim email apa pun (spec booking-payments).
    expect(panggilan.cancellation.length).toBe(0);
    expect(panggilan.confirmation.length).toBe(0);
  });

  test("event tanpa referensi booking tidak melempar error dan tidak mengubah state", async () => {
    await expect(
      handleCheckoutCompleted({ id: "cs_unknown" })
    ).resolves.toBeUndefined();
    await expect(
      handleCheckoutExpired({ id: "cs_unknown" })
    ).resolves.toBeUndefined();
  });

  test("event untuk booking yang tidak ada di DB hanya di-log (aman)", async () => {
    await handleCheckoutCompleted({
      id: "cs_ghost",
      metadata: { bookingId: "00000000-0000-0000-0000-000000000000" },
    });
  });

  test("markPaymentStatus tidak crash saat baris payments tidak ada", async () => {
    const { bookingId } = await seedPendingBooking();
    await handleCheckoutCompleted({
      id: `cs_nopay_${bookingId}`,
      metadata: { bookingId },
    });
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.stripeSessionId, `cs_nopay_${bookingId}`));
    expect(rows.length).toBe(0);
  });
});
