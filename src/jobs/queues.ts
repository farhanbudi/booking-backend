import Redis from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_NAME } from "./types";

function buildConnection(): Redis {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
}

let queue: Queue | null = null;

export function getBookingEmailQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: buildConnection() });
  }
  return queue;
}

export async function closeQueues(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
