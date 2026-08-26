export interface BookingTemplateData {
  userName: string;
  resourceName: string;
  startTime: Date;
  endTime: Date;
}

export interface EmailContent {
  subject: string;
  text: string;
}

const timeFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function formatWaktu(date: Date): string {
  return timeFormatter.format(date);
}

export function renderConfirmationEmail(data: BookingTemplateData): EmailContent {
  return {
    subject: `Konfirmasi Booking - ${data.resourceName}`,
    text: [
      `Halo ${data.userName},`,
      "",
      "Booking Anda berhasil dibuat.",
      "",
      `Resource : ${data.resourceName}`,
      `Mulai    : ${formatWaktu(data.startTime)}`,
      `Selesai  : ${formatWaktu(data.endTime)}`,
      "",
      "Terima kasih.",
    ].join("\n"),
  };
}

export function renderCancellationEmail(data: BookingTemplateData): EmailContent {
  return {
    subject: `Pembatalan Booking - ${data.resourceName}`,
    text: [
      `Halo ${data.userName},`,
      "",
      "Booking Anda telah dibatalkan.",
      "",
      `Resource : ${data.resourceName}`,
      `Mulai    : ${formatWaktu(data.startTime)}`,
      `Selesai  : ${formatWaktu(data.endTime)}`,
      "",
      "Terima kasih.",
    ].join("\n"),
  };
}

export function renderReminderEmail(data: BookingTemplateData): EmailContent {
  return {
    subject: `Pengingat Booking - ${data.resourceName}`,
    text: [
      `Halo ${data.userName},`,
      "",
      "Booking Anda akan segera dimulai dalam waktu kurang dari 1 jam.",
      "",
      `Resource : ${data.resourceName}`,
      `Mulai    : ${formatWaktu(data.startTime)}`,
      `Selesai  : ${formatWaktu(data.endTime)}`,
      "",
      "Terima kasih.",
    ].join("\n"),
  };
}
