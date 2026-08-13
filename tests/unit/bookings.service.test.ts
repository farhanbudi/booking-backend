import { describe, expect, test, beforeAll } from "bun:test";
import {
  getAvailability,
  createBooking,
  cancelBooking,
} from "../../src/modules/bookings/bookings.service";
import { registerUser } from "../../src/modules/auth/auth.service";
import { createResource } from "../../src/modules/resources/resources.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../../src/utils/errors";
import { resetDb } from "../helpers/test-db";

beforeAll(async () => {
  await resetDb();
});

describe("bookings.service", () => {
  test("getAvailability mengembalikan booking aktif dan mengecualikan yang cancelled", async () => {
    const user = await registerUser({ name: "Eko", email: "eko@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Eko", capacity: 4 });

    const aktif = await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2026-08-11T09:00:00.000Z"),
      endTime: new Date("2026-08-11T10:00:00.000Z"),
    });

    const dibatalkan = await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2026-08-11T11:00:00.000Z"),
      endTime: new Date("2026-08-11T12:00:00.000Z"),
    });
    await cancelBooking(dibatalkan.id, user.id, "user");

    const availability = await getAvailability(resource.id, "2026-08-11");
    expect(availability.length).toBe(1);
    expect(availability[0].startTime.toISOString()).toBe("2026-08-11T09:00:00.000Z");
  });

  test("createBooking menolak jika startTime >= endTime", async () => {
    const user = await registerUser({ name: "Fajar", email: "fajar@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Fajar", capacity: 4 });

    try {
      await createBooking({
        userId: user.id,
        resourceId: resource.id,
        startTime: new Date("2026-08-11T10:00:00.000Z"),
        endTime: new Date("2026-08-11T09:00:00.000Z"),
      });
      throw new Error("createBooking seharusnya menolak startTime >= endTime");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
    }
  });

  test("createBooking menolak slot yang sudah terisi", async () => {
    const user = await registerUser({ name: "Gita", email: "gita@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Gita", capacity: 4 });

    await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2026-08-12T09:00:00.000Z"),
      endTime: new Date("2026-08-12T10:00:00.000Z"),
    });

    try {
      await createBooking({
        userId: user.id,
        resourceId: resource.id,
        startTime: new Date("2026-08-12T09:30:00.000Z"),
        endTime: new Date("2026-08-12T10:30:00.000Z"),
      });
      throw new Error("createBooking seharusnya menolak slot yang sudah terisi");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
    }
  });

  test("createBooking berhasil pada slot kosong", async () => {
    const user = await registerUser({ name: "Hana", email: "hana@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Hana", capacity: 4 });

    const booking = await createBooking({
      userId: user.id,
      resourceId: resource.id,
      startTime: new Date("2026-08-13T09:00:00.000Z"),
      endTime: new Date("2026-08-13T10:00:00.000Z"),
    });

    expect(booking.status).toBe("confirmed");
    expect(booking.resourceId).toBe(resource.id);
  });

  test("cancelBooking melempar NotFoundError untuk booking yang tidak ada", async () => {
    try {
      await cancelBooking("00000000-0000-0000-0000-000000000000", "user-id", "user");
      throw new Error("cancelBooking seharusnya melempar NotFoundError");
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
    }
  });

  test("cancelBooking oleh non-pemilik dan non-admin ditolak (ForbiddenError)", async () => {
    const pemilik = await registerUser({ name: "Intan", email: "intan@test.com", password: "rahasia123" });
    const orangLain = await registerUser({ name: "Joko", email: "joko@test.com", password: "rahasia123" });
    const resource = await createResource({ name: "Ruang Intan", capacity: 4 });

    const booking = await createBooking({
      userId: pemilik.id,
      resourceId: resource.id,
      startTime: new Date("2026-08-14T09:00:00.000Z"),
      endTime: new Date("2026-08-14T10:00:00.000Z"),
    });

    try {
      await cancelBooking(booking.id, orangLain.id, "user");
      throw new Error("cancelBooking seharusnya menolak non-pemilik");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
    }
  });
});
