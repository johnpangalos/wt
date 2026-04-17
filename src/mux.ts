export type Mux = "tmux" | "zellij";
export type TmuxPlacement = "new-window" | "split-h" | "split-v";
export type ZellijPlacement = "new-tab" | "new-pane";

export type SwitchArgs = {
  path: string;
  branch: string;
  cmd: string;
};

export type Env = Record<string, string | undefined>;

export function detect(env: Env): Mux | null {
  if (env.TMUX) return "tmux";
  if (env.ZELLIJ) return "zellij";
  if (env.WT_TMUX_TARGET) return "tmux";
  if (env.WT_ZELLIJ_SESSION) return "zellij";
  return null;
}

function normalizeTmuxTarget(target: string): string {
  return target.includes(":") ? target : `${target}:`;
}

export function buildTmuxCmd(
  env: Env,
  args: SwitchArgs,
  placement: TmuxPlacement,
): string[] {
  const argv: string[] = ["tmux"];

  const insideTmux = !!env.TMUX;
  const socket = insideTmux ? undefined : env.WT_TMUX_SOCKET;
  const target = insideTmux ? undefined : env.WT_TMUX_TARGET;

  if (socket) argv.push("-S", socket);

  if (placement === "new-window") {
    argv.push("new-window");
    if (target) argv.push("-t", normalizeTmuxTarget(target));
    argv.push("-c", args.path);
    if (args.branch) argv.push("-n", args.branch);
    argv.push(args.cmd);
  } else if (placement === "split-h" || placement === "split-v") {
    argv.push("split-window", placement === "split-h" ? "-h" : "-v");
    if (target) argv.push("-t", normalizeTmuxTarget(target));
    argv.push("-c", args.path, args.cmd);
  }

  return argv;
}

export function buildZellijCmd(
  env: Env,
  args: SwitchArgs,
  placement: ZellijPlacement,
): string[] {
  const argv: string[] = ["zellij"];
  const insideZellij = !!env.ZELLIJ;
  if (!insideZellij && env.WT_ZELLIJ_SESSION) {
    argv.push("-s", env.WT_ZELLIJ_SESSION);
  }
  argv.push("action");
  if (placement === "new-tab") {
    argv.push("new-tab", "--cwd", args.path);
    if (args.branch) argv.push("--name", args.branch);
    argv.push("--", args.cmd);
  } else if (placement === "new-pane") {
    argv.push("new-pane", "--cwd", args.path, "--", args.cmd);
  }
  return argv;
}

export async function spawnMux(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new Error("empty mux argv");
  const proc = Bun.spawn([cmd, ...rest], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr.trim() || `${cmd} exited ${code}`);
}
