// Refresh token adalah string random dengan entropy tinggi, BUKAN JWT.
// Kita hash sebelum simpan ke DB (mirip prinsip password hashing), TAPI pakai
// hash cepat (SHA-256), BUKAN Bun.password/argon2 yang sengaja lambat.
// Alasan bedanya: password itu secret ber-entropy RENDAH yang dipilih manusia
// (rentan brute force, makanya butuh hash lambat), sedangkan refresh token
// sudah random 256-bit sejak awal — hash cepat sudah cukup untuk melindungi
// isi database kalau bocor, tanpa buang waktu komputasi tiap kali dipakai.

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}