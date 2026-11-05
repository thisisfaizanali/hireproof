import { app } from "./app";
import { env } from "./env";

app.listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT}`);
});
