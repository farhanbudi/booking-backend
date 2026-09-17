import { startServer } from "./server";
import { startWorker } from "./worker";
import { redisConnection } from "./queue";
import { closeMailer } from "./mailer/mailer";

export { startServer, startWorker };

const RUN_MODE = process.env.RUN_MODE ?? "all";
let workerInstance: ReturnType<typeof startWorker> | undefined;

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} diterima, menutup koneksi dengan baik...`);
  if (workerInstance) {
    await workerInstance.close();
  }
  redisConnection.disconnect();
  closeMailer();
  process.exit(0);
}

if (import.meta.main) {
  switch (RUN_MODE) {
    case "api":
      startServer();
      break;
    case "worker":
      workerInstance = startWorker();
      break;
    case "all":
      startServer();
      workerInstance = startWorker();
      break;
    default:
      console.warn(
        `⚠️  RUN_MODE "${RUN_MODE}" tidak dikenali, fallback ke "all" (server + worker jalan bareng)`,
      );
      startServer();
      workerInstance = startWorker();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
