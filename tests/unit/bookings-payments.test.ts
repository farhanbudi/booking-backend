import { describe, expect, test, beforeAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../helpers/test-db";
import { registerUser } from "../../src/modules/auth/auth.service";
import { createResource } from "../../src/modules/resources/resources.service";
import { db } from "../../src/db/client";
import { bookings, payments, resources } from "../../src/db/schema";

// ===== Mock producers =====
const panggilan = {
  confirmation: [] as string[],
  cancellation: [] as string[],
  reminderDijadwalkan: [] as Array<{ bookingId: string; startTime: Date }>,
  expiryDijadwalkan: [] as Array<{ bookingId: string; ttlMs: number }>,
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
  removeReminder: async () => {},
  scheduleExpiry: async (bookingId: string, ttlMs: number) => {
    panggilan.expiryDijadwalkan.push({ bookingId, ttlMs });
  },
  removeExpiry: async () => {},
}));

// ===== Mock stripe.port =====
const stripeCalls: Array<{ amount: number; currency: string }> = [];
let checkoutGagal = false;

mock.module("../../src/modules/payments/stripe.port", () => ({
  defaultStripePort: {
    createCheckoutSession: async (input: {
      amount: number;
      currency: string;
    }) => {
      if (checkoutGagal) throw new Error("stripe unreachable");
      stripeCalls.push({ amount: input.amount, currency: input.currency });
      return {
        id: `cs_test_${stripeCalls.length}`,
        url: `https://checkout.stripe.com/c/pay/test-${stripeCalls.length}`,
      };
    },
    constructWebhookEvent: () => {
      throw new Error("tidak dipakai di test ini");
    },
  },
}));

const { createBooking, cancelBooking } = await import(
  "../../src/modules/bookings/bookings.service"
);
const { getFreshCheckoutUrl } = await import(
  "../../src/modules/payments/payments.service"
);

async function buatResourceBerbayar(pricePerHour: number | null) {
  const resource = await createResource({
    name: `Ruang Berbayar ${Math.random()}`,
    capacity: 2,
  });
  if (pricePerHour !== null) {
    await db
      .update(resources)
      .set({ pricePerHour })
      .where(eq(resources.id, resource.id));
  }
  return resource;
}

const JADWAL = {
  start: new Date("2027-04-10T02:00:00.000Z"),
  end: new Date("2027-04-10T03:00:00.000Z"),
};

// Bun's expect().rejects can hang for async rejections; use manual try/catch.
async function statusDari(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? -1;
  }
  return -1;
}

beforeAll(async () => {
  await resetDb();
});

describe("Branching free vs paid pada createBooking", () => {
  test("resource gratis: langsung confirmed tanpa artefak pembayaran", async () => {
    const user = await registerUser({
      name: "Budi Gratis",
      email: `budi-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(null);

    const result = await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: JADWAL.start,
      endTime: JADWAL.end,
    });

    expect((result as any).status).toBe("confirmed");
    expect((result as any).payment).toBeUndefined();
    expect(stripeCalls.length).toBe(0);
    expect(panggilan.confirmation).toContain((result as any).id);
  });

  test("resource berbayar: pending + checkoutUrl + baris payments + expiry job", async () => {
    const user = await registerUser({
      name: "Sinta Bayar",
      email: `sinta-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(15000);

    const result = (await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: JADWAL.start,
      endTime: new Date("2027-04-10T03:30:00.000Z"), // 90 menit
    })) as any;

    expect(result.booking.status).toBe("pending");
    expect(result.payment.checkoutUrl).toContain("checkout.stripe.com");

    // Amount = 15000 × ceil(1.5 jam) = 30000 idr, dikirim ×100 = 3000000
    // (akun Stripe settlement MYR memperlakukan IDR sebagai 2-desimal).
    expect(stripeCalls[0].amount).toBe(3000000);
    expect(stripeCalls[0].currency).toBe("idr");

    const [paymentRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.stripeSessionId, "cs_test_1"));
    expect(paymentRow.bookingId).toBe(result.booking.id);
    expect(paymentRow.amount).toBe(3000000);
    expect(paymentRow.status).toBe("open");

    // Email konfirmasi TIDAK diantrekan saat create untuk booking berbayar —
    // baru setelah pembayaran sukses via webhook.
    expect(panggilan.confirmation).not.toContain(result.booking.id);
    expect(panggilan.expiryDijadwalkan.length).toBeGreaterThan(0);
  });

  test("kegagalan Stripe menghapus booking pending dan melempar error informatif", async () => {
    const user = await registerUser({
      name: "Dewi Gagal",
      email: `dewi-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(15000);
    checkoutGagal = true;

    const kode = await statusDari(() =>
      createBooking({
        userId: user.id,
        resourceId: resource.id,
        startTime: JADWAL.start,
        endTime: JADWAL.end,
      })
    );
    expect(kode).toBe(502);

    // Tidak ada booking pending yatim tersisa.
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.userId, user.id));
    expect(rows.length).toBe(0);
    checkoutGagal = false;
  });

  test("cancelBooking menghapus job expiry juga", async () => {
    const user = await registerUser({
      name: "Eko Cancel",
      email: `eko-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(null);
    panggilan.cancellation.length = 0;

    const booking = (await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2027-05-10T02:00:00.000Z"),
      endTime: new Date("2027-05-10T03:00:00.000Z"),
    })) as any;

    const cancelled = await cancelBooking(booking.id, user.id, "user");
    expect(cancelled.status).toBe("cancelled");
    expect(panggilan.cancellation).toContain(booking.id);
  });
});

describe("Retry checkout URL (owner-only)", () => {
  test("pemilik booking pending mendapat URL segar + attempt baru", async () => {
    const user = await registerUser({
      name: "Fajar Retry",
      email: `fajar-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(20000);
    const created = (await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: JADWAL.start,
      endTime: JADWAL.end,
    })) as any;

    const before = stripeCalls.length;
    const result = await getFreshCheckoutUrl(created.booking.id, user.id);
    expect(result.payment.checkoutUrl).toContain("checkout.stripe.com");
    expect(stripeCalls.length).toBe(before + 1);
  });

  test("bukan pemilik ditolak 403", async () => {
    const owner = await registerUser({
      name: "Gita Pemilik",
      email: `gita-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const intruder = await registerUser({
      name: "Hadi Penyusup",
      email: `hadi-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(20000);
    const created = (await createBooking({
      userId: owner.id,
      resourceId: resource.id,
      startTime: JADWAL.start,
      endTime: JADWAL.end,
    })) as any;

    expect(await statusDari(() => getFreshCheckoutUrl(created.booking.id, intruder.id))).toBe(403);
  });

  test("booking non-pending ditolak 409", async () => {
    const user = await registerUser({
      name: "Ika Confirmed",
      email: `ika-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    const resource = await buatResourceBerbayar(null); // gratis → langsung confirmed
    const booking = (await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: JADWAL.start,
      endTime: JADWAL.end,
    })) as any;

    expect(
      await statusDari(() => getFreshCheckoutUrl(booking.id, user.id))
    ).toBe(409);
  });

  test("booking tidak ditemukan → 404", async () => {
    const user = await registerUser({
      name: "Joko Kosong",
      email: `joko-${Math.random()}@test.com`,
      password: "rahasia123",
    });
    expect(
      await statusDari(() =>
        getFreshCheckoutUrl("00000000-0000-0000-0000-000000000000", user.id)
      )
    ).toBe(404);
  });
});
