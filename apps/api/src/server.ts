import { app } from "./app";
import { startQueue, stopQueue } from "./cv/queue";
import { prisma } from "./db";
import { env } from "./env";

// Render sends SIGTERM and kills the process after 30 seconds.
const FORCE_EXIT_MS = 25_000;

async function main() {
  await startQueue();
  const server = app.listen(env.PORT, () => {
    console.log(`api listening on :${env.PORT}`);
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref();
    // Finish requests in flight, let running jobs finish, then close the database.
    server.close();
    server.closeIdleConnections();
    stopQueue()
      .then(() => prisma.$disconnect())
      .catch((err) => console.error("shutdown", err))
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
