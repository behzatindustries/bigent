import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type UninstallOptions = {
  purge?: boolean;
};

export async function uninstallBigent(options: UninstallOptions = {}): Promise<string> {
  const home = os.homedir();
  const installDir = process.env.BIGENT_INSTALL_DIR ?? path.join(home, ".local/share/bigent");
  const binPath = process.env.BIGENT_BIN_PATH ?? path.join(home, ".local/bin/bigent");
  const configDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "bigent");
  const servicePath = path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    "systemd/user/bigent-telegram.service",
  );
  const stateDir = process.env.BIGENT_HOME ?? path.join(home, ".bigent");

  runOptional("systemctl", ["--user", "disable", "--now", "bigent-telegram.service"]);
  await fs.rm(servicePath, { force: true });
  runOptional("systemctl", ["--user", "daemon-reload"]);
  await fs.rm(binPath, { force: true });
  await fs.rm(installDir, { recursive: true, force: true });

  const removed = ["user service", binPath, installDir];
  if (options.purge) {
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    removed.push(configDir, stateDir);
  }

  return `BIgent uninstalled.\nRemoved: ${removed.join(", ")}`;
}

function runOptional(command: string, args: string[]): void {
  spawnSync(command, args, { stdio: "ignore" });
}
