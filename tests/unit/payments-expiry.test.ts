import { describe, expect, test, beforeAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../helpers/test-db";
import { db } from "../../src/db/client";
import { bookings, resources, users } from "../../src/db/schema";

// ===== Mock producers: catat email yang terkirim (harusnya NOL untuk expiry) =====
const panggilan = {
  confirmation: [] as string[],
  cancellation: [] as string[],
  reminderDijadwalkan: [] as unknown[],
};

mock.module("../../src/jobs/producers", () => ({
  enqueueConfirmation: async (bookingId: string) => {
    panggilan.confirmation.push(bookingId);
  },
  enqueueCancellation: async (bookingId: string) => {
    panggilan.cancellation.push(bookingId);
  },
  scheduleReminder: async () => {
    panggilan.reminderDijadwalkan.push({});
    return true;
  },
  removeReminder: async () => {},
  scheduleExpiry: async () => {},
  removeExpiry: async () => {},
}));

// Mock stripe.port supaya import payments.service tidak menyentuh SDK asli.
mock.module("../../src/modules/payments/stripe.port", () => ({
  defaultStripePort: {
    createCheckoutSession: async () => ({
      id: "cs_test",
      url: "https://checkout.stripe.com/c/pay/test",
    }),
    constructWebhookEvent: () => {
      throw new Error("tidak dipakai di test ini");
    },
  },
}));

const { bookingEmailProcessor } = await import("../../src/jobs/processors");

async function seedBooking(status: "pending" | "confirmed"): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      name: `User ${Math.random()}`,
      email: `expiry-${Math.random()}@test.com`,
      passwordHash: "x",
    })
    .returning();
  const [resource] = await db
    .insert(resources)
    .values({ name: `Ruang Expiry ${Math.random()}`, pricePerHour: 15000 })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2027-03-10T02:00:00.000Z"),
      endTime: new Date("2027-03-10T03:00:00.000Z"),
      status,
    })
    .returning();
  return booking.id;
}

function expireJob(bookingId: string) {
  return {
    name: "expire-payment",
    data: { bookingId },
  } as unknown as Parameters<typeof bookingEmailProcessor>[0];
}

beforeAll(async () => {
  await resetDb();
});

describe("Processor branch expire-payment", () => {
  test("pending yang telat dibayar dibatalkan otomatis TANPA email apa pun", async () => {
    const bookingId = await seedBooking("pending");
    panggilan.confirmation.length = 0;
    panggilan.cancellation.length = 0;
    panggilan.reminderDijadwalkan.length = 0;

    await bookingEmailProcessor(expireJob(bookingId));

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row.status).toBe("cancelled");
    expect(panggilan.cancellation.length).toBe(0);
    expect(panggilan.confirmation.length).toBe(0);
    expect(panggilan.reminderDijadwalkan.length).toBe(0);
  });

  test("job expiry yang telat menyala pada booking confirmed adalah no-op (tetap confirmed)", async () => {
    const bookingId = await seedBooking("confirmed");

    await bookingEmailProcessor(expireJob(bookingId));

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row.status).toBe("confirmed");
  });
});
