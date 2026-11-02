#!/usr/bin/env node
/**
 * Run a command with the toolchain this repository ships.
 *
 * Why this exists:
 *
 * 1. The machine has no system-wide Rust (`cargo` is not on PATH and there is
 *    no `~/.cargo`). The workspace carries its own rustup install in
 *    `.toolchain/`, usable only when `CARGO_HOME`, `RUSTUP_HOME` and `PATH`
 *    point at it.
 * 2. The system `%TEMP%` cannot be used by this toolchain: `link.exe` fails
 *    with LNK1104 on `lnk{…}.tmp` and esbuild fails with EPERM. Both need a
 *    directory where files can be created and deleted immediately.
 *
 * Fixing both here keeps `npm run tauri:dev` working from any shell — including
 * a freshly opened cmd.exe — without mutating the user's global environment.
 *
 * Usage:
 *   node scripts/toolchain.mjs tauri dev
 *   node scripts/toolchain.mjs tauri build
 *   node scripts/toolchain.mjs cargo test --manifest-path src-tauri/Cargo.toml
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);

const cargoHome = join(root, ".toolchain", "cargo");
const rustupHome = join(root, ".toolchain", "rustup");
const cargoBin = join(cargoHome, "bin");

const env = { ...process.env };

/**
 * Set a variable regardless of how Windows capitalised the inherited key
 * (`Path` vs `PATH`). A plain `env.PATH = …` would leave the old `Path` in
 * place and Windows may pick either one.
 */
function setEnv(key, value) {
  for (const existing of Object.keys(env)) {
    if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
  }
  env[key] = value;
}

function getEnv(key) {
  const match = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase());
  return match ? env[match] : undefined;
}

function findOnPath(command) {
  const pathValue = getEnv("PATH") ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe(command));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const localCargo = join(cargoBin, exe("cargo"));

if (existsSync(localCargo)) {
  // The portable install wins: it holds the registry cache and the pinned
  // toolchain, so builds stay reproducible — and work offline.
  setEnv("CARGO_HOME", cargoHome);
  setEnv("RUSTUP_HOME", rustupHome);
  setEnv("PATH", `${cargoBin}${delimiter}${getEnv("PATH") ?? ""}`);
} else if (!findOnPath("cargo")) {
  console.error(
    [
      "找不到 Rust 工具链。",
      "",
      `本仓库自带一份便携工具链，预期位置：${cargoBin}`,
      "如果该目录被删除，请二选一：",
      "  1. 恢复仓库的 .toolchain 目录；",
      "  2. 安装官方 Rust（rustup + MSVC 工具链）后重跑同一条命令。",
    ].join("\n"),
  );
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("用法: node scripts/toolchain.mjs <command> [...args]");
  process.exit(1);
}

// Repo-local scratch dir: see the LNK1104 / EPERM note at the top. `.tmp/` is
// git-ignored and is the same directory BUILD.md tells users to point TMP at.
try {
  const scratch = join(root, ".tmp");
  mkdirSync(scratch, { recursive: true });
  setEnv("TMP", scratch);
  setEnv("TEMP", scratch);
} catch {
  // Keep the inherited temp directory when the repo is read-only.
}

// Windows resolves `tauri` to `tauri.cmd` through the shell; arguments are
// quoted by hand because shell mode joins them into one command line.
const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
const child = isWindows
  ? spawn([command, ...args].map(quote).join(" "), { cwd: root, env, stdio: "inherit", shell: true })
  : spawn(command, args, { cwd: root, env, stdio: "inherit" });

child.on("error", (err) => {
  console.error(`启动失败: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});
