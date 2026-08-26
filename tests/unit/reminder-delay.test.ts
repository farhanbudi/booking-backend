import { describe, expect, test } from "bun:test";
import { REMINDER_LEAD_TIME_MS, reminderDelayMs } from "../../src/jobs/reminder-delay";

const NOW = new Date("2026-01-05T00:00:00Z");

describe("Util perhitungan delay reminder", () => {
  test("booking > 1 jam dari sekarang → delay positif", () => {
    const startTime = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    expect(reminderDelayMs(startTime, NOW)).toBe(2 * 60 * 60 * 1000);
  });

  test("booking tepat H-1 jam → delay nol tidak dikirim sebagai negatif", () => {
    const startTime = new Date(NOW.getTime() + REMINDER_LEAD_TIME_MS);
    expect(reminderDelayMs(startTime, NOW)).toBeNull();
  });

  test("booking last-minute < 1 jam → tidak dijadwalkan", () => {
    const startTime = new Date(NOW.getTime() + 30 * 60 * 1000);
    expect(reminderDelayMs(startTime, NOW)).toBeNull();
  });
});
