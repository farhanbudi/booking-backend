import { describe, expect, test } from "bun:test";
import {
  formatWaktu,
  renderCancellationEmail,
  renderConfirmationEmail,
  renderReminderEmail,
} from "../../src/mailer/templates";

const data = {
  userName: "Budi",
  resourceName: "Ruang Rapat A",
  startTime: new Date("2026-01-05T03:30:00Z"),
  endTime: new Date("2026-01-05T05:00:00Z"),
};

describe("formatWaktu", () => {
  test("menghasilkan waktu Indonesia yang deterministik (Asia/Jakarta)", () => {
    const hasil = formatWaktu(new Date("2026-01-05T03:30:00Z"));
    expect(hasil).toContain("Januari 2026");
    expect(hasil).toContain("10.30");
  });
});

describe("Template email booking", () => {
  test("konfirmasi memuat sapaan, resource, dan jadwal mulai/selesai", () => {
    const email = renderConfirmationEmail(data);
    expect(email.subject).toContain("Konfirmasi");
    expect(email.subject).toContain(data.resourceName);
    expect(email.text).toContain(data.userName);
    expect(email.text).toContain(data.resourceName);
    expect(email.text).toContain(formatWaktu(data.startTime));
    expect(email.text).toContain(formatWaktu(data.endTime));
  });

  test("pembatalan memuat keterangan pembatalan dan detail booking", () => {
    const email = renderCancellationEmail(data);
    expect(email.subject).toContain("Pembatalan");
    expect(email.text).toContain("dibatalkan");
    expect(email.text).toContain(data.resourceName);
    expect(email.text).toContain(formatWaktu(data.startTime));
    expect(email.text).toContain(formatWaktu(data.endTime));
  });

  test("reminder memuat pengingat dan jadwal booking", () => {
    const email = renderReminderEmail(data);
    expect(email.subject).toContain("Pengingat");
    expect(email.text).toContain("kurang dari 1 jam");
    expect(email.text).toContain(data.resourceName);
    expect(email.text).toContain(formatWaktu(data.startTime));
    expect(email.text).toContain(formatWaktu(data.endTime));
  });
});
