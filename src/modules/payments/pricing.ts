// Perhitungan amount Checkout Session (design D2).
// Durasi dibulatkan KE ATAS ke jam penuh dikali harga per jam; untuk currency
// non-zero-decimal hasil dikonversi ke minor unit (×100) di satu titik ini saja.
//
// CATATAN: IDR sengaja TIDAK ada di set zero-decimal di bawah. Secara standar
// Stripe memang zero-decimal, tapi akun Stripe yang dipakai proyek ini
// (settlement currency = MYR) memperlakukan IDR sebagai 2-desimal, sehingga
// unit_amount harus dikirim dalam satuan terkecil (×100). Mengirim langsung
// (tanpa ×100) memicu error `amount_too_small` karena Rp50.000 terbaca sebagai
// Rp500,00. Jika suatu saat akun di-switch ke settlement IDR, kembalikan "idr"
// ke set ini dan hapus pengalian ×100 di bawah.

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase());
}

export function computeAmountInSmallestUnit(
  pricePerHour: number,
  startTime: Date,
  endTime: Date,
  currency: string
): number {
  const durationMinutes =
    Math.max(0, endTime.getTime() - startTime.getTime()) / 60000;
  const wholeHours = Math.ceil(durationMinutes / 60);
  const baseAmount = pricePerHour * wholeHours;
  return isZeroDecimalCurrency(currency) ? baseAmount : baseAmount * 100;
}
