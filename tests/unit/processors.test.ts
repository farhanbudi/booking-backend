import { describe, expect, test } from "bun:test";
import {
  processBookingEmailData,
  type BookingEmailDeps,
  type BookingEmailDetail,
} from "../../src/jobs/processors";

const detailConfirmed: BookingEmailDetail = {
  status: "confirmed",
  startTime: new Date("2026-01-05T03:30:00Z"),
  endTime: new Date("2026-01-05T05:00:00Z"),
  userEmail: "budi@example.com",
  userName: "Budi",
  resourceName: "Ruang Rapat A",
};

function buatDeps(detail: BookingEmailDetail | null): BookingEmailDeps & {
  terkirim: Array<{ to: string; subject: string }>;
} {
  const terkirim: Array<{ to: string; subject: string }> = [];
  return {
    terkirim,
    fetchBooking: async () => detail,
    sendMail: async (to, content) => {
      terkirim.push({ to, subject: content.subject });
    },
  };
}

describe("Prosesor email booking", () => {
  test("kirim sukses: job confirmation mengirim email konfirmasi ke pemilik booking", async () => {
    const deps = buatDeps(detailConfirmed);
    await processBookingEmailData("confirmation", { bookingId: "b-1" }, deps);
    expect(deps.terkirim.length).toBe(1);
    expect(deps.terkirim[0].to).toBe("budi@example.com");
    expect(deps.terkirim[0].subject).toContain("Konfirmasi");
  });

  test("kirim sukses: job reminder mengirim email pengingat bila masih confirmed", async () => {
    const deps = buatDeps(detailConfirmed);
    await processBookingEmailData("reminder", { bookingId: "b-2" }, deps);
    expect(deps.terkirim.length).toBe(1);
    expect(deps.terkirim[0].subject).toContain("Pengingat");
  });

  test("booking sudah dibatalkan → dilewati tanpa error dan tanpa kirim", async () => {
    const deps = buatDeps({ ...detailConfirmed, status: "cancelled" });
    await processBookingEmailData("confirmation", { bookingId: "b-3" }, deps);
    expect(deps.terkirim.length).toBe(0);
  });

  test("booking tidak ditemukan → log dan lewati tanpa error", async () => {
    const deps = buatDeps(null);
    await processBookingEmailData("cancellation", { bookingId: "tidak-ada" }, deps);
    expect(deps.terkirim.length).toBe(0);
  });

  test("kirim sukses: job cancellation mengirim email pembatalan bila booking berstatus cancelled", async () => {
    const deps = buatDeps({ ...detailConfirmed, status: "cancelled" });
    await processBookingEmailData("cancellation", { bookingId: "b-5" }, deps);
    expect(deps.terkirim.length).toBe(1);
    expect(deps.terkirim[0].subject).toContain("Pembatalan");
  });

  test("job cancellation untuk booking yang masih confirmed → dilewati tanpa kirim", async () => {
    const deps = buatDeps(detailConfirmed);
    await processBookingEmailData("cancellation", { bookingId: "b-6" }, deps);
    expect(deps.terkirim.length).toBe(0);
  });

  test("nama job tidak dikenal → error agar tercatat oleh retry worker", async () => {
    const deps = buatDeps(detailConfirmed);
    let tertangkap: unknown = null;
    try {
      await processBookingEmailData("jenis-tak-dikenal", { bookingId: "b-4" }, deps);
    } catch (e) {
      tertangkap = e;
    }
    expect(tertangkap instanceof Error).toBe(true);
    expect(deps.terkirim.length).toBe(0);
  });
});
