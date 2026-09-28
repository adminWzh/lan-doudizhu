import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.FRONTEND_PORT || "5173";
console.log("\n  ♠ 同桌 · 局域网斗地主\n");
console.log(`  本机打开：http://localhost:${port}`);
for (const list of Object.values(networkInterfaces())) {
  for (const item of list || []) {
    if (
      item.family === "IPv4" &&
      !item.internal &&
      !item.address.startsWith("169.254.")
    )
      console.log(
        `  局域网候选：http://${item.address}:${port} （选择 Wi-Fi/以太网地址）`,
      );
  }
}
console.log(
  "\n  手机连接同一 Wi-Fi，打开上方地址。房间和手牌仅保存在内存中。\n",
);
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  children.forEach((c) => c.kill("SIGTERM"));
  const timer = setTimeout(() => {
    children.forEach((c) => c.kill("SIGKILL"));
    process.exit(code);
  }, 1800);
  timer.unref();
  Promise.all(
    children.map(
      (c) =>
        new Promise((r) =>
          c.exitCode !== null || c.signalCode !== null
            ? r()
            : c.once("exit", r),
        ),
    ),
  ).then(() => process.exit(code));
}
for (const child of children) {
  child.once("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!ending) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
