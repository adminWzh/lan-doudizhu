import { fileURLToPath } from "node:url";
import { createGameServer } from "./app.js";
const port = Number(process.env.PORT || 3001);
const app = createGameServer({
  staticDir: fileURLToPath(new URL("../client/", import.meta.url)),
});
app.server.on("error", (error) => {
  console.error(`后端启动失败（端口 ${port}）：`, error.message);
  process.exit(1);
});
app.server.listen(port, "0.0.0.0", () =>
  console.log(`  游戏服务器已启动：0.0.0.0:${port}`),
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app.close().then(() => process.exit(0));
  });
