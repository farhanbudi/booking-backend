export const QUEUE_NAME = "booking-emails";

export const JOB_NAME_CONFIRMATION = "confirmation";
export const JOB_NAME_CANCELLATION = "cancellation";
export const JOB_NAME_REMINDER = "reminder";
// Job non-email di queue yang sama (design D5): auto-expiry unpaid booking.
export const JOB_NAME_EXPIRE_PAYMENT = "expire-payment";

export interface BookingEmailData {
  bookingId: string;
}

export function reminderJobId(bookingId: string): string {
  return `reminder-${bookingId}`;
}

export function expireJobId(bookingId: string): string {
  return `expire-${bookingId}`;
}
