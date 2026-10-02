import { Worker } from "bullmq";
import { redisConnection } from "./queue";
import { bookingEmailProcessor } from "./jobs/processors";
import { QUEUE_NAME, type BookingEmailData } from "./jobs/types";
import { describeMailTransport, validateMailEnv } from "./mailer/mailer";

function validateEnv(): void {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  try {
    new URL(redisUrl);
  } catch {
    console.error(`[email-worker] REDIS_URL tidak valid: ${redisUrl}`);
    process.exit(1);
  }
  // Cek SMTP_PORT ikut di dalam validateMailEnv() karena hanya relevan saat
  // MAIL_PROVIDER=smtp (design D10).
  const mailErrors = validateMailEnv();
  if (mailErrors.length > 0) {
    for (const message of mailErrors) {
      console.error(`[email-worker] ${message}`);
    }
    process.exit(1);
  }
}

export function startWorker() {
  validateEnv();

  const worker = new Worker<BookingEmailData>(QUEUE_NAME, bookingEmailProcessor, {
    connection: redisConnection,
    removeOnComplete: { age: 600 },
    removeOnFail: { count: 50 },
  });

  worker.on("completed", (job) => {
    console.log(`[email-worker] job ${job.name} (${job.id}) selesai`);
  });

  worker.on("failed", (job, err) => {
    if (!job) {
      console.error("[email-worker] job gagal tanpa data:", err.message);
      return;
    }
    const total = job.opts.attempts ?? 1;
    if (job.attemptsMade >= total) {
      console.error(
        `[email-worker] job ${job.name} (${job.id}) gagal permanen setelah ${total} percobaan: ${err.message}`,
      );
    } else {
      console.warn(
        `[email-worker] job ${job.name} (${job.id}) gagal pada percobaan ${job.attemptsMade}/${total}, akan dicoba ulang: ${err.message}`,
      );
    }
  });

  console.log(
    `[email-worker] berjalan untuk queue "${QUEUE_NAME}" (redis: ${process.env.REDIS_URL ?? "redis://localhost:6379"})`,
  );
  console.log(`[email-worker] mail via ${describeMailTransport()}`);

  return worker;
}
