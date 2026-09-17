import { Queue } from "bullmq";
import IORedis from "ioredis";

export const redisConnection = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const bookingEmailQueue = new Queue("booking-emails", {
  connection: redisConnection,
});
