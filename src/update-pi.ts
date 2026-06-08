import { spawnSync } from "node:child_process";

export type UpdatePiOptions = {
  commit?: boolean;
};

export function updatePiDependency(options: UpdatePiOptions = {}): void {
  run("npm", ["install", "@earendil-works/pi-coding-agent@latest", "@earendil-works/pi-ai@latest"]);
  run("npm", ["run", "build"]);
  if (options.commit) {
    run("git", ["add", "package.json", "package-lock.json"]);
    run("git", ["commit", "-m", "chore: update pi sdk"]);
    console.log("Pi SDK updated, BIgent rebuilt, and repo commit created.");
    return;
  }
  console.log("Pi SDK updated and BIgent rebuilt. Review package-lock.json, then commit the update.");
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
