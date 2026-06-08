import { spawnSync } from "node:child_process";

export type ServiceAction = "start" | "stop" | "restart" | "status" | "enable" | "disable";

export function runServiceAction(action: ServiceAction): string {
  const args =
    action === "status"
      ? ["--user", "status", "bigent-telegram.service", "--no-pager"]
      : ["--user", action, "bigent-telegram.service"];
  return run("systemctl", args);
}

export function serviceLogs(): string {
  return run("journalctl", ["--user", "-u", "bigent-telegram.service", "-n", "80", "--no-pager"]);
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return output || "OK";
}
