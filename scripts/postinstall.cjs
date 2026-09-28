// npm 8 running on Node 16 skips newer optional native bindings before the
// project-local Node runtime is installed. Reify them once using that runtime.
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const requireFromRolldown = createRequire(
  require.resolve("rolldown/package.json"),
);
const platform = process.platform === "win32" ? "win32" : process.platform;
const suffix =
  platform === "linux"
    ? process.report.getReport().header.glibcVersionRuntime
      ? "-gnu"
      : "-musl"
    : platform === "win32"
      ? "-msvc"
      : "";
try {
  requireFromRolldown.resolve(
    `@rolldown/binding-${platform}-${process.arch}${suffix}`,
  );
} catch {
  console.log("使用项目内 Node.js 补全本机编译依赖…");
  const runtime = resolve(
    "node_modules/node/bin/node" + (process.platform === "win32" ? ".exe" : ""),
  );
  const result = spawnSync(
    runtime,
    [
      process.env.npm_execpath,
      "install",
      "--ignore-scripts",
      "--include=optional",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "inherit" },
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
