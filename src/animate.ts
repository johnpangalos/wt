// `wt animate` — a hidden pond. Not in --help on purpose.
//
// Animations are 8-bit-style pixel scenes: a pure function of (tick, cols)
// returning a grid of palette keys, two pixel rows per terminal line. The
// player draws each pixel pair as a ▀ half-block — 256-color foreground for
// the top pixel, background for the bottom — and redraws in place. Without a
// color terminal it falls back to plain characters.

export type PixelGrid = string[];

export type Animation = {
  name: string;
  description: string;
  fps: number;
  /** Pure: the same tick and cols always yield the same grid. */
  frame(tick: number, cols: number): PixelGrid;
};

type PaletteEntry = { color: number; plain: string };

// Palette keys are single chars; "." in sprites means transparent.
const PALETTE: Record<string, PaletteEntry> = {
  S: { color: 117, plain: " " }, // sky
  C: { color: 255, plain: "o" }, // cloud
  U: { color: 226, plain: "*" }, // sun
  Y: { color: 220, plain: "#" }, // duck body
  G: { color: 178, plain: "#" }, // duck wing
  O: { color: 208, plain: ">" }, // beak
  K: { color: 16, plain: "@" }, // eye
  "^": { color: 159, plain: "^" }, // foam / wave crest
  w: { color: 45, plain: "~" }, // surface water
  b: { color: 39, plain: "~" }, // mid water
  d: { color: 33, plain: "-" }, // deep water
  z: { color: 27, plain: "." }, // deepest water
  L: { color: 34, plain: "o" }, // lily pad
  P: { color: 205, plain: "*" }, // lily flower
  R: { color: 196, plain: "%" }, // crab shell
  D: { color: 124, plain: "%" }, // crab legs
  N: { color: 223, plain: "." }, // sand
  T: { color: 180, plain: "," }, // sand speckle
  E: { color: 230, plain: "O" }, // eggshell
  g: { color: 76, plain: "," }, // grass
  h: { color: 28, plain: "." }, // grass shade
};

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function makeGrid(rows: number, cols: number, fill: string): string[][] {
  return Array.from({ length: rows }, () => Array<string>(cols).fill(fill));
}

/** Overlay a sprite at (x, y); "." is transparent, off-grid clips. */
function stamp(g: string[][], sprite: readonly string[], x: number, y: number): void {
  for (let r = 0; r < sprite.length; r++) {
    const row = g[y + r];
    const line = sprite[r];
    if (!row || !line) continue;
    for (let i = 0; i < line.length; i++) {
      const px = line[i];
      if (!px || px === ".") continue;
      const col = x + i;
      if (col < 0 || col >= row.length) continue;
      row[col] = px;
    }
  }
}

function finish(g: string[][]): PixelGrid {
  return g.map((row) => row.join(""));
}

function colorOf(key: string | undefined): number {
  return (key !== undefined ? PALETTE[key]?.color : undefined) ?? 16;
}

function plainOf(key: string | undefined): string {
  return (key !== undefined ? PALETTE[key]?.plain : undefined) ?? " ";
}

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

/** Two pixel rows per line: ▀ with fg = top pixel, bg = bottom pixel. */
export function renderColor(grid: PixelGrid): string[] {
  const lines: string[] = [];
  for (let y = 0; y + 1 < grid.length; y += 2) {
    const top = grid[y] ?? "";
    const bottom = grid[y + 1] ?? "";
    let line = "";
    let lastFg = -1;
    let lastBg = -1;
    for (let x = 0; x < top.length; x++) {
      const fg = colorOf(top[x]);
      const bg = colorOf(bottom[x]);
      if (fg !== lastFg || bg !== lastBg) {
        line += `${ESC}38;5;${fg};48;5;${bg}m`;
        lastFg = fg;
        lastBg = bg;
      }
      line += "▀";
    }
    lines.push(line + RESET);
  }
  return lines;
}

/** Colorless fallback: one char per pixel pair, skies deferring to what's below. */
export function renderPlain(grid: PixelGrid): string[] {
  const lines: string[] = [];
  for (let y = 0; y + 1 < grid.length; y += 2) {
    const top = grid[y] ?? "";
    const bottom = grid[y + 1] ?? "";
    let line = "";
    for (let x = 0; x < top.length; x++) {
      const t = top[x];
      line += t !== undefined && t !== "S" ? plainOf(t) : plainOf(bottom[x]);
    }
    lines.push(line.replace(/ +$/, ""));
  }
  return lines;
}

const SUN = [
  ".UUU.",
  "UUUUU",
  ".UUU.",
] as const;

const CLOUD = [
  "..CCC..",
  "CCCCCCC",
] as const;

const DUCK = [
  "...YY.......",
  "..YYYY......",
  "OOYKYY......",
  "..YYYY......",
  "...YYY....Y.",
  "...YYGGGGYY.",
  "....YYYYYY..",
] as const;

const DUCK_BLINK = [
  "...YY.......",
  "..YYYY......",
  "OOYYYY......",
  "..YYYY......",
  "...YYY....Y.",
  "...YYGGGGYY.",
  "....YYYYYY..",
] as const;

const DUCK_WIDTH = 12;

const LILY = [
  "..P..",
  "LLLLL",
] as const;

function duckFrame(tick: number, cols: number): PixelGrid {
  const surface = 9;
  const g = makeGrid(16, cols, "S");

  // Water: surface crests drift right, deeper highlight streaks drift slower
  // (parallax) while the duck paddles left across it all.
  for (let x = 0; x < cols; x++) {
    for (let y = surface; y < 16; y++) {
      const row = g[y];
      if (!row) continue;
      if (y === surface) {
        row[x] = mod(x - (tick >> 1), 11) < 2 ? "^" : "w";
      } else if (y <= surface + 2) {
        row[x] = mod(x + (tick >> 2) + y * 5, 13) === 0 ? "w" : "b";
      } else if (y <= surface + 4) {
        row[x] = mod(x - (tick >> 3) + y * 7, 17) === 0 ? "b" : "d";
      } else {
        row[x] = mod(x + (tick >> 3) + y * 3, 23) === 0 ? "d" : "z";
      }
    }
  }

  stamp(g, SUN, cols - 7, 0);
  const cloudX = mod(tick >> 3, cols + 7) - 7;
  stamp(g, CLOUD, cloudX, 1);

  // A lily pad rides the surface drift.
  const lilyX = mod(Math.floor(cols / 3) + (tick >> 2), cols + 5) - 5;
  stamp(g, LILY, lilyX, surface - 1);

  // Fully visible at the right edge on tick 0 (the pond is never empty on a
  // single-frame render), then paddle off stage left and wrap around.
  const duckX = cols - DUCK_WIDTH - mod(tick, cols + DUCK_WIDTH);
  const bob = (tick >> 3) % 2;
  stamp(g, ["^.^"], duckX + DUCK_WIDTH + (tick % 2), surface);
  stamp(g, mod(tick, 32) >= 29 ? DUCK_BLINK : DUCK, duckX, surface - 6 + bob);

  return finish(g);
}

const CRAB_A = [
  "..K.......K..",
  "..R..RRR..R..",
  "RR.RRRRRRR.RR",
  ".RRRRRRRRRRR.",
  ".D..D...D..D.",
] as const;

const CRAB_B = [
  "..K.......K..",
  "..R..RRR..R..",
  "R..RRRRRRR..R",
  ".RRRRRRRRRRR.",
  "..D..D.D..D..",
] as const;

const CRAB_WIDTH = 13;

function crabFrame(tick: number, cols: number): PixelGrid {
  const g = makeGrid(12, cols, "S");

  // Sea on the horizon, then beach all the way down — the crab stays on it.
  for (let x = 0; x < cols; x++) {
    const sea = g[5];
    if (sea) sea[x] = mod(x - (tick >> 2), 9) < 2 ? "w" : "b";
    for (let y = 6; y < 12; y++) {
      const row = g[y];
      if (row) row[x] = mod(x * 7 + y * 3, 13) === 0 ? "T" : "N";
    }
  }

  stamp(g, SUN, cols - 7, 0);
  const cloudX = cols - mod(tick >> 3, cols + 7);
  stamp(g, CLOUD, cloudX, 1);

  const crabX = mod(tick, cols + CRAB_WIDTH) - CRAB_WIDTH;
  stamp(g, (tick >> 1) % 2 === 0 ? CRAB_A : CRAB_B, crabX, 6);

  return finish(g);
}

const EGG = [
  "..EEE..",
  ".EEEEE.",
  "EEEEEEE",
  "EEEEEEE",
  "EEEEEEE",
  ".EEEEE.",
] as const;

const EGG_CRACK1 = [
  "..EEE..",
  ".EEEEE.",
  "EEKEEEE",
  "EEEKEEE",
  "EEEEEEE",
  ".EEEEE.",
] as const;

const EGG_CRACK2 = [
  "..EEE..",
  ".EKEEE.",
  "EEKEKEE",
  "EEEKEEE",
  "EEKEEKE",
  ".EEEEE.",
] as const;

const SHELL_TOP = [
  "..EEE..",
  ".EEEEE.",
  "E.E.E.E",
] as const;

const SHELL_BOTTOM = [
  "E.E.E.E",
  "EEEEEEE",
  ".EEEEE.",
] as const;

const PEEK = [
  "..YYY..",
  ".YYYYY.",
  "OYKYYY.",
] as const;

const DUCKLING_A = [
  "..YYY..",
  ".YYYYY.",
  "OYKYYY.",
  ".YYYGG.",
  "..K.K..",
] as const;

const DUCKLING_B = [
  "..YYY..",
  ".YYYYY.",
  "OYKYYY.",
  ".YYGGY.",
  ".K...K.",
] as const;

const HATCH_CYCLE = 96;

function eggFrame(tick: number, cols: number): PixelGrid {
  const g = makeGrid(16, cols, "S");
  const t = mod(tick, HATCH_CYCLE);

  // A grassy meadow instead of water — the pond comes later in life.
  for (let x = 0; x < cols; x++) {
    for (let y = 12; y < 16; y++) {
      const row = g[y];
      if (row) row[x] = mod(x * 5 + y * 7, 11) === 0 ? "h" : "g";
    }
    const tuft = g[11];
    if (tuft && mod(x * 11, 29) === 0) tuft[x] = "g";
  }

  stamp(g, SUN, cols - 7, 0);
  const cloudX = mod(tick >> 3, cols + 7) - 7;
  stamp(g, CLOUD, cloudX, 1);

  const eggX = Math.floor(cols / 2) - 3;
  if (t < 56) {
    // Still, then cracking — the wobble gets more frantic as hatching nears.
    const sprite = t < 24 ? EGG : t < 44 ? EGG_CRACK1 : EGG_CRACK2;
    const wob =
      t < 24 ? (mod(t, 12) < 2 ? 1 : 0) : t < 44 ? (mod(t, 6) < 3 ? 1 : -1) : mod(t, 2) === 0 ? 1 : -1;
    stamp(g, sprite, eggX + wob, 6);
  } else if (t < 68) {
    // Pop: the top half flies off while the duckling peeks out of the bottom.
    stamp(g, SHELL_TOP, eggX, 6 - (t - 56));
    stamp(g, PEEK, eggX, 7);
    stamp(g, SHELL_BOTTOM, eggX, 9);
  } else {
    // Out and about: waddle away from the shell, flapping.
    stamp(g, SHELL_BOTTOM, eggX, 9);
    const duckX = eggX - 2 - ((t - 68) >> 2);
    stamp(g, (t >> 1) % 2 === 0 ? DUCKLING_A : DUCKLING_B, duckX, 7);
  }

  return finish(g);
}

export const ANIMATIONS: Animation[] = [
  {
    name: "duck",
    description: "a duck paddling across a pond",
    fps: 12,
    frame: duckFrame,
  },
  {
    name: "crab",
    description: "a crab scuttling along the beach",
    fps: 12,
    frame: crabFrame,
  },
  {
    name: "egg",
    description: "an egg that hatches into a duckling",
    fps: 12,
    frame: eggFrame,
  },
];

export const DEFAULT_ANIMATION = "duck";

export function findAnimation(name: string): Animation | undefined {
  return ANIMATIONS.find((a) => a.name === name);
}

export type PlayOpts = {
  cols: number;
  frames: number;
  delayMs: number;
  tty: boolean;
  color: boolean;
  out: { write(s: string): unknown };
};

export async function play(anim: Animation, opts: PlayOpts): Promise<void> {
  const { out, tty } = opts;
  const render = opts.color ? renderColor : renderPlain;
  const onSigint = (): void => {
    out.write(`${ESC}?25h${RESET}\n`);
    process.exit(0);
  };
  if (tty) {
    out.write(`${ESC}?25l`);
    process.on("SIGINT", onSigint);
  }
  let height = 0;
  try {
    for (let tick = 0; tick < opts.frames; tick++) {
      const lines = render(anim.frame(tick, opts.cols));
      if (tty && tick > 0) out.write(`${ESC}${height}A`);
      height = lines.length;
      for (const l of lines) out.write(tty ? `${l}${ESC}K\n` : `${l}\n`);
      if (tick + 1 < opts.frames) {
        if (!tty) out.write("\n");
        if (opts.delayMs > 0) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
      }
    }
  } finally {
    if (tty) {
      out.write(`${ESC}?25h`);
      process.off("SIGINT", onSigint);
    }
  }
}

export async function cmdAnimate(args: string[]): Promise<void> {
  let frames: number | null = null;
  let list = false;
  let forceColor = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--list") {
      list = true;
    } else if (a === "--color") {
      forceColor = true;
    } else if (a === "--frames") {
      const v = args[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--frames expects a positive integer");
      }
      frames = n;
    } else if (a !== undefined) {
      positional.push(a);
    }
  }

  if (list) {
    for (const a of ANIMATIONS) {
      process.stdout.write(`${a.name}\t${a.description}\n`);
    }
    return;
  }

  const name = positional[0] ?? DEFAULT_ANIMATION;
  const anim = findAnimation(name);
  if (!anim) {
    throw new Error(`unknown animation: ${name} (try: wt animate --list)`);
  }

  const tty = process.stdout.isTTY === true;
  const color = process.env.NO_COLOR === undefined && (tty || forceColor);
  const cols = Math.max(20, Math.min(process.stdout.columns ?? 80, 100));
  await play(anim, {
    cols,
    frames: frames ?? (tty ? Number.POSITIVE_INFINITY : 1),
    delayMs: 1000 / anim.fps,
    tty,
    color,
    out: process.stdout,
  });
}
