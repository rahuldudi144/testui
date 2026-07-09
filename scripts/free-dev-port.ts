const port = Number(process.argv[2] ?? 4000);
if (!Number.isFinite(port) || port <= 0) process.exit(0);

const result = Bun.spawnSync(["lsof", "-ti", `:${port}`], { stdout: "pipe" });
if (!result.success || result.stdout.length === 0) process.exit(0);

const pids = new TextDecoder()
  .decode(result.stdout)
  .trim()
  .split("\n")
  .filter(Boolean);

for (const pid of pids) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n === process.pid) continue;
  try {
    process.kill(n, "SIGTERM");
  } catch {
    // Process already exited.
  }
}
