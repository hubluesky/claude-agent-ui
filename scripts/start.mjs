#!/usr/bin/env node
/**
 * Claude Agent UI — 跨平台统一启动脚本
 *
 * Usage:
 *   node scripts/start.mjs              # 前台模式（默认）
 *   node scripts/start.mjs --headless   # 无头模式，无终端窗口，日志写入 logs/server.log
 *
 * Headless 实现:
 *   Windows: PowerShell Start-Process -WindowStyle Hidden 启动 --headless-worker
 *   macOS/Linux: detached + unref 经典 daemon 化
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, openSync, createWriteStream } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectDir = resolve(__dirname, "..");
const scriptPath = join(projectDir, "scripts", "start.mjs");

const headless = process.argv.includes("--headless");
const headlessWorker = process.argv.includes("--headless-worker");
const isWin = process.platform === "win32";

// --- Resolve tsx CLI entry point ---
function findTsxCliEntry() {
  const candidates = [
    join(projectDir, "packages/server/node_modules/.bin"),
    join(projectDir, "node_modules/.bin"),
  ];
  for (const binDir of candidates) {
    const entry = resolve(binDir, "..", "tsx", "dist", "cli.mjs");
    if (existsSync(entry)) return entry;
  }
  return null;
}

// --- Determine command & args ---
function resolveCommand() {
  const tsxEntry = findTsxCliEntry();
  const hasSrc = existsSync(join(projectDir, "packages/web/src"));
  const hasDist = existsSync(join(projectDir, "packages/server/dist/index.js"));

  if (hasSrc && tsxEntry) {
    return {
      cmd: process.execPath,
      args: [tsxEntry, "watch", join(projectDir, "packages/server/src/index.ts"), "--mode=dev"],
      label: "dev mode, tsx watch",
    };
  }
  if (tsxEntry) {
    return {
      cmd: process.execPath,
      args: [tsxEntry, join(projectDir, "packages/server/src/index.ts"), "--mode=auto"],
      label: "production mode",
    };
  }
  if (hasDist) {
    return {
      cmd: process.execPath,
      args: [join(projectDir, "packages/server/dist/index.js"), "--mode=auto"],
      label: "production mode",
    };
  }
  return null;
}

const resolved = resolveCommand();
if (!resolved) {
  console.error("[ERROR] No server files found. Run: pnpm install && pnpm build");
  process.exit(1);
}

const { cmd, args, label } = resolved;
const logDir = join(projectDir, "logs");
const logFile = join(logDir, "server.log");
const pidFile = join(logDir, "server.pid");

// ============================================================
// Mode: --headless-worker (internal, launched by --headless)
// Long-lived wrapper: spawns server, pipes output to log file.
// ============================================================
if (headlessWorker) {
  mkdirSync(logDir, { recursive: true });
  const logStream = createWriteStream(logFile, { flags: "a" });

  const child = spawn(cmd, args, {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Write OUR PID (the worker), not the child's — we're the stable long-lived process.
  // Killing us will also kill the child.
  writeFileSync(pidFile, String(process.pid));

  child.on("exit", (code) => process.exit(code ?? 1));
  process.on("SIGTERM", () => child.kill());
  process.on("SIGINT", () => child.kill());
  // Keep alive — child's stdio pipes keep the event loop running.
} else if (headless) {
// ============================================================
// Mode: --headless (user-facing entry)
// Launches the worker process hidden + detached.
// ============================================================
  mkdirSync(logDir, { recursive: true });

  console.log(`Starting Claude Agent UI (headless, ${label})...`);
  console.log(`Log:  ${logFile}`);
  console.log(`PID:  ${pidFile}`);

  if (isWin) {
    // PowerShell Start-Process -WindowStyle Hidden: zero visible windows.
    // Launches this same script with --headless-worker.
    const workerArgs = `'${scriptPath}','--headless-worker'`;
    const psCmd = `$p = Start-Process -FilePath '${process.execPath}' -ArgumentList ${workerArgs} -WindowStyle Hidden -PassThru; $p.Id`;

    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", psCmd], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();

    const pid = parseInt(output.split("\n").pop(), 10);
    if (pid > 0) {
      console.log(`Server started (PID: ${pid})`);
      console.log(`To stop: taskkill /PID ${pid} /T /F`);
    } else {
      console.error(`[ERROR] Failed to start. PowerShell output: ${output}`);
      process.exit(1);
    }
  } else {
    // Unix: spawn worker detached + unref, classic daemonization.
    const child = spawn(process.execPath, [scriptPath, "--headless-worker"], {
      cwd: projectDir,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    console.log(`Server started (PID: ${child.pid})`);
    console.log(`To stop: kill ${child.pid}`);
  }

  process.exit(0);
} else {
// ============================================================
// Mode: foreground (default)
// ============================================================
  console.log(`Starting Claude Agent UI (${label})...`);

  const fgChild = spawn(cmd, args, {
    cwd: projectDir,
    stdio: "inherit",
  });

  fgChild.on("exit", (code) => process.exit(code ?? 0));

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => fgChild.kill(sig));
  }
}
