export const REMINDER_LEAD_TIME_MS = 60 * 60 * 1000;

export function reminderDelayMs(startTime: Date, now: Date = new Date()): number | null {
  const delay = startTime.getTime() - REMINDER_LEAD_TIME_MS - now.getTime();
  return delay > 0 ? delay : null;
}
