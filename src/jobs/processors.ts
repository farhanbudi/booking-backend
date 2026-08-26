import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, resources, users } from "../db/schema";
import { sendMail as sendMailViaSmtp } from "../mailer/mailer";
import {
  renderCancellationEmail,
  renderConfirmationEmail,
  renderReminderEmail,
  type BookingTemplateData,
  type EmailContent,
} from "../mailer/templates";
import {
  JOB_NAME_CANCELLATION,
  JOB_NAME_CONFIRMATION,
  JOB_NAME_REMINDER,
  type BookingEmailData,
} from "./types";

export interface BookingEmailDetail {
  status: string;
  startTime: Date;
  endTime: Date;
  userEmail: string;
  userName: string;
  resourceName: string;
}

export interface BookingEmailDeps {
  fetchBooking(bookingId: string): Promise<BookingEmailDetail | null>;
  sendMail(to: string, content: EmailContent): Promise<void>;
}

async function fetchBookingFromDb(
  bookingId: string,
): Promise<BookingEmailDetail | null> {
  const rows = await db
    .select({
      status: bookings.status,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      userEmail: users.email,
      userName: users.name,
      resourceName: resources.name,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .innerJoin(resources, eq(bookings.resourceId, resources.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return rows[0] ?? null;
}

const defaultDeps: BookingEmailDeps = {
  fetchBooking: fetchBookingFromDb,
  sendMail: sendMailViaSmtp,
};

function renderEmail(jobName: string, data: BookingTemplateData): EmailContent {
  switch (jobName) {
    case JOB_NAME_CONFIRMATION:
      return renderConfirmationEmail(data);
    case JOB_NAME_CANCELLATION:
      return renderCancellationEmail(data);
    case JOB_NAME_REMINDER:
      return renderReminderEmail(data);
    default:
      throw new Error(`Nama job email tidak dikenal: ${jobName}`);
  }
}

export async function processBookingEmailData(
  jobName: string,
  data: BookingEmailData,
  deps: BookingEmailDeps = defaultDeps,
): Promise<void> {
  const detail = await deps.fetchBooking(data.bookingId);

  if (!detail) {
    console.warn(
      `[email-worker] booking ${data.bookingId} tidak ditemukan, email "${jobName}" dilewati`,
    );
    return;
  }

  // Email pembatalan justru dikirim saat booking berstatus "cancelled";
  // konfirmasi & reminder hanya valid untuk booking yang masih "confirmed"
  // (proteksi anti-stale terhadap retry/delayed job).
  const expectedStatus =
    jobName === JOB_NAME_CANCELLATION ? "cancelled" : "confirmed";

  if (detail.status !== expectedStatus) {
    console.log(
      `[email-worker] booking ${data.bookingId} berstatus "${detail.status}", email "${jobName}" dilewati`,
    );
    return;
  }

  const content = renderEmail(jobName, {
    userName: detail.userName,
    resourceName: detail.resourceName,
    startTime: detail.startTime,
    endTime: detail.endTime,
  });
  await deps.sendMail(detail.userEmail, content);
}

export async function bookingEmailProcessor(
  job: Job<BookingEmailData>,
): Promise<void> {
  await processBookingEmailData(job.name, job.data);
}
