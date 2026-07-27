import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repositoryRoot = process.cwd();
const vinextCli = path.join("node_modules", "vinext", "dist", "cli.js");
const buildArguments = [vinextCli, "build", ...process.argv.slice(2)];
const hasOnlyAsciiPath = [...repositoryRoot].every(
  (character) => character.codePointAt(0) <= 0x7f,
);

function runVinext(cwd) {
  const result = spawnSync(process.execPath, buildArguments, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function mountAsciiDrive(target) {
  for (let code = "Z".charCodeAt(0); code >= "D".charCodeAt(0); code -= 1) {
    const drive = `${String.fromCharCode(code)}:`;
    if (existsSync(`${drive}\\`)) continue;

    const result = spawnSync("subst", [drive, target], { stdio: "ignore" });
    if (result.status === 0) return drive;
  }

  throw new Error(
    "Vinext needs a free drive letter to build this non-ASCII Windows path.",
  );
}

if (process.platform !== "win32" || hasOnlyAsciiPath) {
  process.exitCode = runVinext(repositoryRoot);
} else {
  const drive = mountAsciiDrive(repositoryRoot);
  let buildExitCode = 1;
  let cleanupExitCode = 1;

  console.log(
    `[build] Using temporary ${drive}\\ alias for the non-ASCII Windows path.`,
  );

  try {
    buildExitCode = runVinext(`${drive}\\`);
  } finally {
    cleanupExitCode = spawnSync("subst", [drive, "/D"], {
      stdio: "ignore",
    }).status ?? 1;
  }

  if (cleanupExitCode !== 0) {
    throw new Error(`Failed to remove temporary build alias ${drive}.`);
  }

  process.exitCode = buildExitCode;
}
