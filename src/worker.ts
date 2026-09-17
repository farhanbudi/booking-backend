import { Worker } from "bullmq";
import { redisConnection } from "./queue";
import { bookingEmailProcessor } from "./jobs/processors";
import { QUEUE_NAME, type BookingEmailData } from "./jobs/types";

function validateEnv(): void {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  try {
    new URL(redisUrl);
  } catch {
    console.error(`[email-worker] REDIS_URL tidak valid: ${redisUrl}`);
    process.exit(1);
  }
  if (
    process.env.SMTP_PORT !== undefined &&
    !Number.isFinite(Number(process.env.SMTP_PORT))
  ) {
    console.error("[email-worker] SMTP_PORT harus berupa angka");
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

  return worker;
}
