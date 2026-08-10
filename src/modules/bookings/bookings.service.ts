import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { bookings } from "../../db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
} from "../../utils/errors";

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
  return db.transaction(async (tx) => {
    const overlapping = await tx.execute(sql`
      SELECT id FROM bookings
      WHERE resource_id = ${input.resourceId}
        AND status <> 'cancelled'
        AND tstzrange(start_time, end_time) && tstzrange(${input.startTime.toISOString()}::timestamptz, ${input.endTime.toISOString()}::timestamptz)
      FOR UPDATE
    `);

    if (overlapping.length > 0) {
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
          status: "confirmed",
        })
        .returning();

      return booking;
    } catch (err: any) {
      // Fallback kalau exclusion constraint di database yang menangkap overlap
      // (harusnya jarang kena karena sudah dicek di atas, tapi tetap ditangani).
      if (err?.code === PG_EXCLUSION_VIOLATION) {
        throw new ConflictError(
          "Slot waktu ini sudah dibooking oleh orang lain. Silakan pilih waktu lain."
        );
      }
      throw err;
    }
  });
}

export async function listUserBookings(userId: string) {
  return db.query.bookings.findMany({
    where: eq(bookings.userId, userId),
    orderBy: (b, { desc }) => [desc(b.startTime)],
  });
}

export async function listAllBookings() {
  return db.query.bookings.findMany({
    orderBy: (b, { desc }) => [desc(b.startTime)],
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

  return updated;
}
