import nodemailer from "nodemailer";
import type { EmailContent } from "./templates";

function buildTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    auth: user && pass ? { user, pass } : undefined,
  });
}

const transport = buildTransport();

const from = process.env.MAIL_FROM ?? "Booking App <no-reply@example.com>";

export async function sendMail(to: string, content: EmailContent): Promise<void> {
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
