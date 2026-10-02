// Stub nodemailer yang dipakai bersama oleh test mailer.
//
// Dipisah ke modul helper karena `mailer.ts` membangun transport di level modul:
// `mock.module` harus terdaftar SEBELUM `mailer.ts` di-import, dan semua file
// test berbagi satu proses. Dengan mengimpor modul ini lebih dulu, kedua file
// test mereferensikan instance modul yang sama dan recorder yang sama.
import { mock } from "bun:test";

export interface SentMail {
  to: string;
  subject: string;
}

export const fakeMailer = {
  terkirim: [] as SentMail[],
  error: null as Error | null,
  reset(): void {
    this.terkirim.length = 0;
    this.error = null;
  },
};

function buatTransport() {
  return {
    sendMail: async (options: { to: string; subject: string }) => {
      if (fakeMailer.error) throw fakeMailer.error;
      fakeMailer.terkirim.push({ to: options.to, subject: options.subject });
    },
    close: () => {},
  };
}

// Namespace dibuat lengkap (default + named exports) agar tidak merusak module
// linking di file test lain — lihat catatan di AGENTS.md.
mock.module("nodemailer", () => ({
  default: { createTransport: buatTransport },
  createTransport: buatTransport,
  createTestAccount: async () => ({}),
}));
