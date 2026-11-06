import { app } from "./app";
import { startQueue, stopQueue } from "./cv/queue";
import { env } from "./env";

async function main() {
  await startQueue();
  const server = app.listen(env.PORT, () => {
    console.log(`api listening on :${env.PORT}`);
  });
  const shutdown = () => {
    server.close();
    stopQueue().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
