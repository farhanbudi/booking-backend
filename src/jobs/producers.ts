import { getBookingEmailQueue } from "./queues";
import { reminderDelayMs } from "./reminder-delay";
import {
  JOB_NAME_CANCELLATION,
  JOB_NAME_CONFIRMATION,
  JOB_NAME_EXPIRE_PAYMENT,
  JOB_NAME_REMINDER,
  expireJobId,
  reminderJobId,
  type BookingEmailData,
} from "./types";

const retryOpts = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
};

export async function enqueueConfirmation(bookingId: string): Promise<void> {
  const data: BookingEmailData = { bookingId };
  await getBookingEmailQueue().add(JOB_NAME_CONFIRMATION, data, retryOpts);
}

export async function enqueueCancellation(bookingId: string): Promise<void> {
  const data: BookingEmailData = { bookingId };
  await getBookingEmailQueue().add(JOB_NAME_CANCELLATION, data, retryOpts);
}

export async function scheduleReminder(
  bookingId: string,
  startTime: Date,
  now: Date = new Date(),
): Promise<boolean> {
  const delay = reminderDelayMs(startTime, now);
  if (delay === null) {
    return false;
  }
  const data: BookingEmailData = { bookingId };
  await getBookingEmailQueue().add(JOB_NAME_REMINDER, data, {
    ...retryOpts,
    delay,
    jobId: reminderJobId(bookingId),
  });
  return true;
}

export async function removeReminder(bookingId: string): Promise<void> {
  await getBookingEmailQueue().remove(reminderJobId(bookingId));
}

// Job delayed auto-expiry untuk booking pending yang tidak dibayar (design D5).
// attempts:1 karena job telat pun aman — gerbang transisi kondisional yang memutuskan.
export async function scheduleExpiry(
  bookingId: string,
  ttlMs: number
): Promise<void> {
  const data: BookingEmailData = { bookingId };
  await getBookingEmailQueue().add(JOB_NAME_EXPIRE_PAYMENT, data, {
    delay: ttlMs,
    jobId: expireJobId(bookingId),
    attempts: 1,
  });
}

export async function removeExpiry(bookingId: string): Promise<void> {
  await getBookingEmailQueue().remove(expireJobId(bookingId));
}
