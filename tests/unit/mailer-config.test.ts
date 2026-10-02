import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// Impor helper lebih dulu agar nodemailer ter-stub sebelum mailer.ts di-import;
// urutan ini dijamin oleh test mailer-send.test.ts yang memakai recorder yang sama.
import "../helpers/fake-nodemailer";
import {
  describeMailTransport,
  isDemoRecipient,
  resolveMailProvider,
  resolveTransportOptions,
  validateMailEnv,
} from "../../src/mailer/mailer";

const MAIL_KEYS = [
  "MAIL_PROVIDER",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "MAILGUN_SMTP_HOST",
  "MAILGUN_SMTP_PORT",
  "MAILGUN_SMTP_LOGIN",
  "MAILGUN_SMTP_PASSWORD",
  "DEMO_EMAIL",
  "MAIL_FROM",
] as const;

// Nilai asli diambil sekali saat modul dimuat, sebelum test apa pun mengubah env.
const original: Record<string, string | undefined> = {};
for (const key of MAIL_KEYS) {
  original[key] = process.env[key];
}

// Semua file test berbagi satu proses, jadi env yang dimodifikasi HARUS dikembalikan.
beforeEach(() => {
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

function setMailgunLengkap(port = "587") {
  process.env.MAIL_PROVIDER = "mailgun";
  process.env.MAILGUN_SMTP_HOST = "smtp.mailgun.org";
  process.env.MAILGUN_SMTP_PORT = port;
  process.env.MAILGUN_SMTP_LOGIN = "postmaster@booking.test";
  process.env.MAILGUN_SMTP_PASSWORD = "key-123456";
}

describe("Resolusi provider mail", () => {
  test("default ke smtp saat MAIL_PROVIDER kosong", () => {
    expect(resolveMailProvider()).toBe("smtp");
  });

  test("menghormati MAIL_PROVIDER yang diisi", () => {
    process.env.MAIL_PROVIDER = "smtp";
    expect(resolveMailProvider()).toBe("smtp");

    process.env.MAIL_PROVIDER = "mailgun";
    expect(resolveMailProvider()).toBe("mailgun");
  });

  test("mengabaikan spasi di sekitar nilai", () => {
    process.env.MAIL_PROVIDER = "  mailgun  ";
    expect(resolveMailProvider()).toBe("mailgun");
  });
});

describe("Opsi transport smtp", () => {
  test("default ke localhost:1025 tanpa autentikasi dan tanpa TLS", () => {
    const options = resolveTransportOptions();
    expect(options.host).toBe("localhost");
    expect(options.port).toBe(1025);
    expect(options.secure).toBe(false);
    expect(options.auth).toBeUndefined();
  });

  test("menghormati SMTP_HOST dan SMTP_PORT", () => {
    process.env.SMTP_HOST = "smtp.kantor.co.id";
    process.env.SMTP_PORT = "587";
    const options = resolveTransportOptions();
    expect(options.host).toBe("smtp.kantor.co.id");
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
  });

  test("mengaktifkan TLS hanya pada port 465", () => {
    process.env.SMTP_PORT = "465";
    expect(resolveTransportOptions().secure).toBe(true);
  });

  test("autentikasi hanya aktif bila user dan pass keduanya ada", () => {
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    expect(resolveTransportOptions().auth).toEqual({ user: "user", pass: "pass" });

    delete process.env.SMTP_PASS;
    expect(resolveTransportOptions().auth).toBeUndefined();

    process.env.SMTP_USER = "";
    process.env.SMTP_PASS = "pass";
    expect(resolveTransportOptions().auth).toBeUndefined();
  });
});

describe("Opsi transport mailgun", () => {
  test("mengikuti host, port, login, dan password dari env", () => {
    setMailgunLengkap();
    const options = resolveTransportOptions();
    expect(options.host).toBe("smtp.mailgun.org");
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
    expect(options.auth).toEqual({
      user: "postmaster@booking.test",
      pass: "key-123456",
    });
  });

  test("mengaktifkan TLS hanya pada port 465", () => {
    setMailgunLengkap("465");
    expect(resolveTransportOptions().secure).toBe(true);
  });

  test("mengabaikan SMTP_HOST/PORT/USER/PASS yang tertinggal", () => {
    setMailgunLengkap();
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    const options = resolveTransportOptions();
    expect(options.host).toBe("smtp.mailgun.org");
    expect(options.port).toBe(587);
    expect(options.auth).toEqual({
      user: "postmaster@booking.test",
      pass: "key-123456",
    });
  });
});

describe("Validasi konfigurasi mail", () => {
  test("smtp default valid", () => {
    expect(validateMailEnv()).toEqual([]);
  });

  test("provider tidak dikenal ditolak tanpa fallback diam-diam", () => {
    process.env.MAIL_PROVIDER = "rsend";
    const errors = validateMailEnv();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("tidak dikenali");
    expect(errors[0]).toContain("rsend");
  });

  test("mailgun wajib punya host, port, login, dan password", () => {
    process.env.MAIL_PROVIDER = "mailgun";
    process.env.DEMO_EMAIL = "demo@example.com";
    const errors = validateMailEnv();
    expect(errors.length).toBe(4);
    for (const key of [
      "MAILGUN_SMTP_HOST",
      "MAILGUN_SMTP_PORT",
      "MAILGUN_SMTP_LOGIN",
      "MAILGUN_SMTP_PASSWORD",
    ]) {
      expect(errors.some((e) => e.includes(key))).toBe(true);
    }
  });

  test("mailgun wajib punya DEMO_EMAIL", () => {
    setMailgunLengkap();
    const errors = validateMailEnv();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("DEMO_EMAIL");
  });

  test("MAILGUN_SMTP_PORT non-numerik ditolak", () => {
    setMailgunLengkap();
    process.env.MAILGUN_SMTP_PORT = "abc";
    process.env.DEMO_EMAIL = "demo@example.com";
    const errors = validateMailEnv();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("MAILGUN_SMTP_PORT");
  });

  test("mailgun lengkap valid", () => {
    setMailgunLengkap();
    process.env.DEMO_EMAIL = "demo@example.com";
    expect(validateMailEnv()).toEqual([]);
  });

  test("SMTP_PORT non-numerik hanya ditolak pada mode smtp", () => {
    process.env.SMTP_PORT = "abc";
    expect(validateMailEnv()[0]).toContain("SMTP_PORT");

    setMailgunLengkap();
    process.env.DEMO_EMAIL = "demo@example.com";
    expect(validateMailEnv()).toEqual([]);
  });
});

describe("Filter penerima demo", () => {
  test("cocok walau berbeda huruf besar-kecil", () => {
    process.env.DEMO_EMAIL = "Budi@Example.com";
    expect(isDemoRecipient("budi@example.com")).toBe(true);
    expect(isDemoRecipient("BUDI@EXAMPLE.COM")).toBe(true);
  });

  test("cocok walau ada spasi di sekitar", () => {
    process.env.DEMO_EMAIL = "  demo@example.com  ";
    expect(isDemoRecipient("demo@example.com")).toBe(true);
  });

  test("tidak cocok untuk email lain", () => {
    process.env.DEMO_EMAIL = "demo@example.com";
    expect(isDemoRecipient("orang-lain@example.com")).toBe(false);
  });

  test("tidak ada yang cocok bila DEMO_EMAIL kosong", () => {
    expect(isDemoRecipient("demo@example.com")).toBe(false);
  });
});

describe("Deskripsi transport untuk log startup", () => {
  test("mode smtp menyebut host dan port", () => {
    expect(describeMailTransport()).toBe("smtp (localhost:1025)");
  });

  test("mode mailgun menyebut endpoint dan penerima demo tanpa password", () => {
    setMailgunLengkap("465");
    process.env.MAILGUN_SMTP_PASSWORD = "rahasia-123";
    process.env.DEMO_EMAIL = "demo@example.com";
    const description = describeMailTransport();
    expect(description).toContain("smtp.mailgun.org:465");
    expect(description).toContain("demo@example.com");
    expect(description).not.toContain("rahasia-123");
    expect(description).not.toContain("postmaster@booking.test");
  });
});
