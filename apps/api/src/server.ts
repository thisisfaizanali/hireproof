import { app } from "./app";
import { loadEnv } from "./env";

const env = loadEnv();

app.listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT}`);
});
