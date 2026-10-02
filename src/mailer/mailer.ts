import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { EmailContent } from "./templates";

const MAIL_PROVIDERS = ["smtp", "mailgun"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

// Port yang mewajibkan TLS sejak koneksi dibuka (bukan STARTTLS).
const IMPLICIT_TLS_PORT = 465;

function isMailProvider(value: string): value is MailProvider {
  return (MAIL_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Provider aktif. Nilai kosong/tidak disetel jatuh ke "smtp" agar konfigurasi
 * lokal yang ada sekarang tetap valid. Nilai yang TIDAK dikenal juga jatuh ke
 * "smtp" di sini — `validateMailEnv()` adalah penjaga resmi untuk kasus itu dan
 * membuat worker berhenti start, jadi tidak perlu validation ganda di lapisan ini.
 */
export function resolveMailProvider(): MailProvider {
  const raw = process.env.MAIL_PROVIDER?.trim() ?? "";
  return isMailProvider(raw) ? raw : "smtp";
}

export function resolveTransportOptions(): SMTPTransport.Options {
  if (resolveMailProvider() === "mailgun") {
    const port = Number(process.env.MAILGUN_SMTP_PORT ?? "");
    return {
      host: process.env.MAILGUN_SMTP_HOST ?? "",
      port,
      secure: port === IMPLICIT_TLS_PORT,
      auth: {
        user: process.env.MAILGUN_SMTP_LOGIN ?? "",
        pass: process.env.MAILGUN_SMTP_PASSWORD ?? "",
      },
    };
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT ?? 1025);
  return {
    host: process.env.SMTP_HOST ?? "localhost",
    port,
    secure: port === IMPLICIT_TLS_PORT,
    auth: user && pass ? { user, pass } : undefined,
  };
}

/**
 * Daftar pesan error konfigurasi mail (Bahasa Indonesia).
 * Mengembalikan daftar alih-alih langsung `console.error` supaya bisa diuji
 * tanpa menangkap stdout; `worker.ts` yang memutuskan untuk exit.
 */
export function validateMailEnv(): string[] {
  const errors: string[] = [];
  const raw = process.env.MAIL_PROVIDER?.trim() ?? "";
  const provider = isMailProvider(raw) ? raw : null;

  if (raw !== "" && provider === null) {
    errors.push(
      `MAIL_PROVIDER "${raw}" tidak dikenali. Nilai yang valid: "smtp" atau "mailgun"`,
    );
    return errors;
  }

  if (provider === "mailgun") {
    for (const key of [
      "MAILGUN_SMTP_HOST",
      "MAILGUN_SMTP_LOGIN",
      "MAILGUN_SMTP_PASSWORD",
    ] as const) {
      if (!process.env[key]?.trim()) {
        errors.push(`${key} wajib diisi saat MAIL_PROVIDER=mailgun`);
      }
    }
    const port = process.env.MAILGUN_SMTP_PORT;
    if (!port?.trim()) {
      errors.push("MAILGUN_SMTP_PORT wajib diisi saat MAIL_PROVIDER=mailgun");
    } else if (!Number.isFinite(Number(port))) {
      errors.push("MAILGUN_SMTP_PORT harus berupa angka");
    }
    if (!process.env.DEMO_EMAIL?.trim()) {
      errors.push(
        "DEMO_EMAIL wajib diisi saat MAIL_PROVIDER=mailgun (alamat satu-satunya yang boleh menerima email di produksi)",
      );
    }
    return errors;
  }

  if (
    process.env.SMTP_PORT !== undefined &&
    !Number.isFinite(Number(process.env.SMTP_PORT))
  ) {
    errors.push("SMTP_PORT harus berupa angka");
  }

  return errors;
}

/**
 * Perbandingan case-insensitive + tahan spasi: `auth.service.ts` menyimpan email
 * apa adanya tanpa normalisasi, jadi akun demo bisa terdaftar dengan case berbeda.
 */
export function isDemoRecipient(to: string): boolean {
  const demo = process.env.DEMO_EMAIL?.trim().toLowerCase();
  if (!demo) return false;
  return to.trim().toLowerCase() === demo;
}

/** Ringkasan konfigurasi aktif untuk log startup. Tidak pernah memuat password. */
export function describeMailTransport(): string {
  if (resolveMailProvider() === "mailgun") {
    const demo = process.env.DEMO_EMAIL?.trim();
    const host = process.env.MAILGUN_SMTP_HOST ?? "";
    const port = process.env.MAILGUN_SMTP_PORT ?? "";
    return `mailgun (${host}:${port}), penerima demo: ${demo || "-"}`;
  }
  const options = resolveTransportOptions();
  return `smtp (${options.host}:${options.port})`;
}

const transport = nodemailer.createTransport(resolveTransportOptions());

const from = process.env.MAIL_FROM ?? "Booking App <no-reply@example.com>";

export async function sendMail(to: string, content: EmailContent): Promise<void> {
  // Penjaga kuota free tier: di mode mailgun hanya akun demo yang dideliver.
  // BullMQ tetap menganggap job ini sukses (tidak ada throw), jadi tidak ada retry.
  if (resolveMailProvider() === "mailgun" && !isDemoRecipient(to)) {
    console.log(
      `[mailer] email "${content.subject}" ke ${to} dilewati — hanya DEMO_EMAIL yang dikirim di mode mailgun`,
    );
    return;
  }

  await transport.sendMail({
    from,
    to,
    subject: content.subject,
    text: content.text,
  });
}

export async function closeMailer(): Promise<void> {
  transport.close();
}