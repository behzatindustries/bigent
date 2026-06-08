import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UpdatePiOptions = {
  commit?: boolean;
};

export function updatePiDependency(options: UpdatePiOptions = {}): void {
  run("npm", ["install", "--ignore-scripts", "@earendil-works/pi-coding-agent@latest", "@earendil-works/pi-ai@latest"]);
  run("npm", ["run", "build"]);
  if (options.commit) {
    run("git", ["add", "package.json", "package-lock.json"]);
    run("git", ["commit", "-m", "chore: update pi sdk"]);
    console.log("Pi SDK updated, BIgent rebuilt, and repo commit created.");
    return;
  }
  console.log("Pi SDK updated and BIgent rebuilt. Review package-lock.json, then commit the update.");
}

export function updateAgentAndPi(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run("git", ["-C", repoRoot, "pull", "--ff-only", "origin", "main"]);
  run("npm", ["install", "--ignore-scripts", "@earendil-works/pi-coding-agent@latest", "@earendil-works/pi-ai@latest"], repoRoot);
  run("npm", ["run", "build"], repoRoot);
  console.log("BIgent and Pi SDK updated.");
}

function run(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
