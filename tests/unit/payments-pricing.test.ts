import { describe, expect, test } from "bun:test";
import {
  computeAmountInSmallestUnit,
  isZeroDecimalCurrency,
} from "../../src/modules/payments/pricing";

describe("Perhitungan amount pembayaran (pricing)", () => {
  const start = new Date("2027-01-10T02:00:00.000Z");

  test("durasi pas satu jam dikali harga per jam (idr dikirim ×100)", () => {
    const amount = computeAmountInSmallestUnit(
      15000,
      start,
      new Date("2027-01-10T03:00:00.000Z"),
      "idr"
    );
    expect(amount).toBe(1500000); // 15000 × 100 (akun Stripe MYR perlakukan IDR 2-desimal)
  });

  test("durasi pecahan jam dibulatkan KE ATAS ke jam penuh", () => {
    const amount = computeAmountInSmallestUnit(
      10000,
      start,
      new Date("2027-01-10T03:30:00.000Z"), // 90 menit
      "idr"
    );
    expect(amount).toBe(2000000);
  });

  test("durasi beberapa detik lebih tetap dihitung satu jam", () => {
    const amount = computeAmountInSmallestUnit(
      5000,
      start,
      new Date("2027-01-10T02:00:01.000Z"),
      "idr"
    );
    expect(amount).toBe(500000);
  });

  test("currency non-zero-decimal dikonversi ke minor unit (×100)", () => {
    const amount = computeAmountInSmallestUnit(
      10,
      start,
      new Date("2027-01-10T03:30:00.000Z"), // 90 menit → 2 jam
      "usd"
    );
    expect(amount).toBe(2000); // 20 USD → 2000 cent
  });

  test("idr TIDAK zero-decimal karena akun Stripe settlement MYR (dikirim ×100)", () => {
    expect(isZeroDecimalCurrency("idr")).toBe(false);
    expect(isZeroDecimalCurrency("IDR")).toBe(false);
    expect(isZeroDecimalCurrency("usd")).toBe(false);
    expect(isZeroDecimalCurrency("jpy")).toBe(true);
  });
});
