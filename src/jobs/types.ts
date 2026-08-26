export const QUEUE_NAME = "booking-emails";

export const JOB_NAME_CONFIRMATION = "confirmation";
export const JOB_NAME_CANCELLATION = "cancellation";
export const JOB_NAME_REMINDER = "reminder";

export interface BookingEmailData {
  bookingId: string;
}

export function reminderJobId(bookingId: string): string {
  return `reminder-${bookingId}`;
}
