import { describe, expect, test, beforeAll, mock } from "bun:test";
import { resetDb } from "../helpers/test-db";
import { registerUser } from "../../src/modules/auth/auth.service";
import { createResource } from "../../src/modules/resources/resources.service";

const panggilan = {
  confirmation: [] as string[],
  cancellation: [] as string[],
  reminderDijadwalkan: [] as Array<{ bookingId: string; startTime: Date }>,
  reminderDihapus: [] as string[],
};

let producerGagal = false;

mock.module("../../src/jobs/producers", () => ({
  enqueueConfirmation: async (bookingId: string) => {
    if (producerGagal) throw new Error("redis down");
    panggilan.confirmation.push(bookingId);
  },
  enqueueCancellation: async (bookingId: string) => {
    if (producerGagal) throw new Error("redis down");
    panggilan.cancellation.push(bookingId);
  },
  scheduleReminder: async (bookingId: string, startTime: Date) => {
    if (producerGagal) throw new Error("redis down");
    panggilan.reminderDijadwalkan.push({ bookingId, startTime });
    return true;
  },
  removeReminder: async (bookingId: string) => {
    if (producerGagal) throw new Error("redis down");
    panggilan.reminderDihapus.push(bookingId);
  },
}));

const { createBooking, cancelBooking } = await import(
  "../../src/modules/bookings/bookings.service"
);

beforeAll(async () => {
  await resetDb();
});

describe("Integrasi email jobs pada bookings.service", () => {
  test("createBooking memicu enqueueConfirmation dan scheduleReminder", async () => {
    const user = await registerUser({ name: "Kiki", email: "kiki@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Kiki", capacity: 2 });
    const startTime = new Date("2026-08-20T09:00:00.000Z");

    const booking = await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime,
      endTime: new Date("2026-08-20T10:00:00.000Z"),
    });

    expect(panggilan.confirmation).toContain(booking.id);
    expect(panggilan.reminderDijadwalkan.length).toBe(1);
    expect(panggilan.reminderDijadwalkan[0].bookingId).toBe(booking.id);
    expect(panggilan.reminderDijadwalkan[0].startTime.getTime()).toBe(startTime.getTime());
  });

  test("cancelBooking memicu enqueueCancellation dan removeReminder tanpa reminder baru", async () => {
    const user = await registerUser({ name: "Lala", email: "lala@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Lala", capacity: 2 });

    const booking = await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2026-08-21T09:00:00.000Z"),
      endTime: new Date("2026-08-21T10:00:00.000Z"),
    });

    panggilan.reminderDijadwalkan.length = 0;

    const cancelled = await cancelBooking(booking.id, user.id, "user");

    expect(cancelled.status).toBe("cancelled");
    expect(panggilan.cancellation).toContain(booking.id);
    expect(panggilan.reminderDihapus).toContain(booking.id);
    expect(panggilan.reminderDijadwalkan.length).toBe(0);
  });

  test("kegagalan antrean tidak mengubah hasil API create maupun cancel", async () => {
    producerGagal = true;
    try {
      const user = await registerUser({ name: "Mimi", email: "mimi@test.com", password: "rahasia123" });
      const resource = await createResource({ name: "Ruang Mimi", capacity: 2 });

      const booking = await createBooking({
        userId: user.id,
        resourceId: resource.id,
        startTime: new Date("2026-08-22T09:00:00.000Z"),
        endTime: new Date("2026-08-22T10:00:00.000Z"),
      });
      expect(booking.status).toBe("confirmed");

      const cancelled = await cancelBooking(booking.id, user.id, "user");
      expect(cancelled.status).toBe("cancelled");
    } finally {
      producerGagal = false;
    }
  });
});
