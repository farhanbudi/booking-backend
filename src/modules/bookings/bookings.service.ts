import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { bookings, resources, users } from "../../db/schema";
import {
  enqueueCancellation,
  enqueueConfirmation,
  removeExpiry,
  removeReminder,
  scheduleExpiry,
  scheduleReminder,
} from "../../jobs/producers";
import {
  createPendingPayment,
} from "../payments/payments.service";
import { getPaymentExpiryMs } from "../payments/payment-config";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
} from "../../utils/errors";
import { logger } from "../../utils/logger";

// Ambil semua booking aktif (bukan cancelled) untuk resource tertentu pada rentang tanggal tertentu.
// Dipakai frontend untuk menampilkan slot yang sudah terisi di kalender/slot picker.
export async function getAvailability(resourceId: string, date: string) {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const existingBookings = await db.query.bookings.findMany({
    where: and(
      eq(bookings.resourceId, resourceId),
      ne(bookings.status, "cancelled"),
      gte(bookings.startTime, dayStart),
      lte(bookings.endTime, dayEnd)
    ),
  });

  return existingBookings.map((b) => ({
    startTime: b.startTime,
    endTime: b.endTime,
  }));
}

export async function createBooking(input: {
  userId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
}) {
  if (input.startTime >= input.endTime) {
    throw new ConflictError("startTime harus lebih awal dari endTime");
  }

  // Resource harus ada untuk menentukan alur gratis vs berbayar.
  const [resource] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, input.resourceId))
    .limit(1);
  if (!resource) {
    throw new NotFoundError("Resource tidak ditemukan");
  }

  // Resource dengan pricePerHour > 0 = berbayar: booking masuk sebagai "pending"
  // dan menahan slot lewat exclusion constraint yang sama sampai dibayar/di-expire.
  const isPaid = resource.pricePerHour != null && resource.pricePerHour > 0;

  // === BAGIAN PALING PENTING DARI PROYEK INI ===
  // Strategi dua lapis untuk mencegah double-booking:
  //
  // Lapis 1 (application-level, di dalam transaction):
  //   Cek dulu apakah ada booking lain yang overlap, sambil mengunci baris terkait
  //   dengan `FOR UPDATE` supaya request bersamaan tidak bisa lolos cek secara bersamaan.
  //
  // Lapis 2 (database-level, safety net):
  //   Exclusion constraint `no_overlapping_bookings` (lihat db/migrations) akan menolak
  //   INSERT yang overlap meskipun lapis 1 entah kenapa terlewat (misal karena bug,
  //   atau ada proses lain yang insert langsung ke DB tanpa lewat service ini).
  // Email konfirmasi + reminder dikirim di background (fire-and-forget) SETELAH
  // transaksi DB sukses. Kegagalan antrean tidak boleh menggagalkan request.
  const created = await db.transaction(async (tx) => {
    const overlapping = await tx.execute(sql`
      SELECT id FROM bookings
      WHERE resource_id = ${input.resourceId}
        AND status <> 'cancelled'
        AND tstzrange(start_time, end_time) && tstzrange(${input.startTime.toISOString()}::timestamptz, ${input.endTime.toISOString()}::timestamptz)
      FOR UPDATE
    `);

    if (overlapping.length > 0) {
      logger.warn(
        {
          resourceId: input.resourceId,
          startTime: input.startTime,
          endTime: input.endTime,
        },
        "double booking ditolak oleh cek FOR UPDATE"
      );
      throw new ConflictError(
        "Slot waktu ini sudah dibooking oleh orang lain. Silakan pilih waktu lain."
      );
    }

    try {
      const [booking] = await tx
        .insert(bookings)
        .values({
          userId: input.userId,
          resourceId: input.resourceId,
          startTime: input.startTime,
          endTime: input.endTime,
          status: isPaid ? "pending" : "confirmed",
        })
        .returning();

      return booking;
    } catch (err: any) {
      // Fallback kalau exclusion constraint di database yang menangkap overlap
      // (harusnya jarang kena karena sudah dicek di atas, tapi tetap ditangani).
      if (err?.code === PG_EXCLUSION_VIOLATION) {
        logger.warn(
          {
            resourceId: input.resourceId,
            startTime: input.startTime,
            endTime: input.endTime,
          },
          "double booking ditolak oleh exclusion constraint database"
        );
        throw new ConflictError(
          "Slot waktu ini sudah dibooking oleh orang lain. Silakan pilih waktu lain."
        );
      }
      throw err;
    }
  });

  logger.info(
    {
      bookingId: created.id,
      resourceId: created.resourceId,
      userId: created.userId,
    },
    "booking berhasil dibuat"
  );

  if (!isPaid) {
    try {
      await enqueueConfirmation(created.id);
      await scheduleReminder(created.id, created.startTime);
    } catch (err) {
      console.warn(
        `[bookings] gagal mengantre email konfirmasi/reminder untuk booking ${created.id}:`,
        err
      );
    }

    return created;
  }

  // === Alur berbayar ===
  let payment;
  try {
    payment = await createPendingPayment(created, resource);
  } catch (err) {
    // Checkout gagal dibuat => jangan tinggalkan booking pending yatim yang
    // selamanya menahan slot. Hapus lalu laporkan error yang jelas ke klien.
    console.error("[bookings] createPendingPayment gagal:", err);
    try {
      await db.delete(bookings).where(eq(bookings.id, created.id));
    } catch (cleanupErr) {
      console.error(
        `[bookings] gagal menghapus booking pending ${created.id} setelah checkout gagal:`,
        cleanupErr
      );
    }
    throw new AppError(
      "Gagal membuat sesi pembayaran. Silakan coba beberapa saat lagi.",
      502
    );
  }

  // Job auto-expiry membatalkan pending yang tak dibayar sebelum TTL (design D5).
  // Gagal antre hanya di-log; gerbang transisi kondisional menjaga kebenaran state.
  try {
    await scheduleExpiry(created.id, getPaymentExpiryMs());
  } catch (err) {
    console.warn(
      `[bookings] gagal menjadwalkan expiry job untuk booking ${created.id}:`,
      err
    );
  }

  return { booking: created, payment };
}

export async function listUserBookings(userId: string) {
  return db.query.bookings.findMany({
    where: eq(bookings.userId, userId),
    columns: {
      id: true,
      userId: true,
      resourceId: true,
      startTime: true,
      endTime: true,
      status: true,
      createdAt: true,
    },
    with: {
      user: {
        columns: { name: true },
      },
      resource: {
        columns: { name: true, location: true },
      },
    },
    orderBy: (bookings, { desc }) => [desc(bookings.startTime)],
  });
}

export async function listAllBookings() {
  return db.query.bookings.findMany({
    columns: {
      id: true,
      userId: true,
      resourceId: true,
      startTime: true,
      endTime: true,
      status: true,
      createdAt: true,
    },
    with: {
      user: {
        columns: { name: true },
      },
      resource: {
        columns: { name: true, location: true },
      },
    },
    orderBy: (bookings, { desc }) => [desc(bookings.startTime)],
  });
}

export async function cancelBooking(bookingId: string, userId: string, role: string) {
  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, bookingId),
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan");
  }

  if (booking.userId !== userId && role !== "admin") {
    throw new ForbiddenError("Kamu tidak berhak membatalkan booking ini");
  }

  const [updated] = await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(eq(bookings.id, bookingId))
    .returning();

  try {
    await enqueueCancellation(updated.id);
    await removeReminder(updated.id);
    // Booking pending yang dibatalkan manual juga tidak perlu job expiry lagi.
    await removeExpiry(updated.id);
  } catch (err) {
    console.warn(
      `[bookings] gagal mengantre email pembatalan/penghapusan job reminder & expiry untuk booking ${updated.id}:`,
      err
    );
  }

  return updated;
}
