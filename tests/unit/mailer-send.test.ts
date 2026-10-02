import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// Impor helper pertama: mendaftarkan mock nodemailer sebelum mailer.ts di-import.
import { fakeMailer } from "../helpers/fake-nodemailer";
import { sendMail } from "../../src/mailer/mailer";

const KONTEKS = {
  subject: "Konfirmasi booking",
  text: "Isi email",
};

const MAIL_KEYS = ["MAIL_PROVIDER", "DEMO_EMAIL"] as const;

const original: Record<string, string | undefined> = {};
for (const key of MAIL_KEYS) {
  original[key] = process.env[key];
}

beforeEach(() => {
  fakeMailer.reset();
  for (const key of MAIL_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MAIL_KEYS) {
    const value = original[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function setMailgunMode(demoEmail: string): void {
  process.env.MAIL_PROVIDER = "mailgun";
  process.env.DEMO_EMAIL = demoEmail;
}

describe("Guard DEMO_EMAIL di sendMail()", () => {
  test("mode mailgun: penerima selain akun demo tidak dikirim", async () => {
    setMailgunMode("demo@example.com");
    await sendMail("orang-lain@example.com", KONTEKS);
    expect(fakeMailer.terkirim.length).toBe(0);
  });

  test("mode mailgun: job yang di-skip selesai tanpa error (BullMQ tidak retry)", async () => {
    setMailgunMode("demo@example.com");
    let selesai = false;
    try {
      await sendMail("orang-lain@example.com", KONTEKS);
      selesai = true;
    } catch {
      selesai = false;
    }
    expect(selesai).toBe(true);
  });

  test("mode mailgun: akun demo tetap dikirimi email", async () => {
    setMailgunMode("demo@example.com");
    await sendMail("demo@example.com", KONTEKS);
    expect(fakeMailer.terkirim.length).toBe(1);
    expect(fakeMailer.terkirim[0].to).toBe("demo@example.com");
  });

  test("mode mailgun: akun demo dengan case berbeda tetap dikirimi email", async () => {
    setMailgunMode("Demo@Example.com");
    await sendMail("demo@example.com", KONTEKS);
    expect(fakeMailer.terkirim.length).toBe(1);
  });

  test("mode smtp: guard tidak berlaku, semua penerima dikirim", async () => {
    process.env.MAIL_PROVIDER = "smtp";
    process.env.DEMO_EMAIL = "demo@example.com";
    await sendMail("orang-lain@example.com", KONTEKS);
    expect(fakeMailer.terkirim.length).toBe(1);
  });

  test("error transport tetap diteruskan agar retry BullMQ tidak berubah", async () => {
    setMailgunMode("demo@example.com");
    fakeMailer.error = new Error("SMTP 421");
    let pesan: string | null = null;
    try {
      await sendMail("demo@example.com", KONTEKS);
    } catch (err) {
      pesan = err instanceof Error ? err.message : String(err);
    }
    expect(pesan).toBe("SMTP 421");
  });

  test("error transport tidak muncul di jalur skip", async () => {
    setMailgunMode("demo@example.com");
    fakeMailer.error = new Error("SMTP 421");
    let dilempar = false;
    try {
      await sendMail("orang-lain@example.com", KONTEKS);
    } catch {
      dilempar = true;
    }
    expect(dilempar).toBe(false);
  });
});
