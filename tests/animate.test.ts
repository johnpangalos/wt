import { describe, it, expect, beforeAll } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

import {
  ANIMATIONS,
  DEFAULT_ANIMATION,
  findAnimation,
  play,
  renderColor,
  renderPlain,
} from "../src/animate";
import { runCli } from "./helpers";

const BIN = resolve(import.meta.dir, "..", "bin", "wt");

describe("animate: registry", () => {
  it("includes the duck, the crab, and the egg", () => {
    expect(ANIMATIONS.map((a) => a.name)).toEqual(["duck", "crab", "egg"]);
  });
  it("default animation exists", () => {
    expect(findAnimation(DEFAULT_ANIMATION)).toBeDefined();
  });
  it("findAnimation returns undefined for unknown names", () => {
    expect(findAnimation("goose")).toBeUndefined();
  });
});

describe("animate: pixel grids are pure and well-formed", () => {
  for (const anim of ANIMATIONS) {
    describe(anim.name, () => {
      it("is deterministic", () => {
        expect(anim.frame(7, 80)).toEqual(anim.frame(7, 80));
      });
      it("keeps a constant even height across ticks", () => {
        const h = anim.frame(0, 80).length;
        expect(h % 2).toBe(0);
        for (let t = 1; t < 200; t++) {
          expect(anim.frame(t, 80).length).toBe(h);
        }
      });
      it("every row is exactly the given width", () => {
        for (const cols of [20, 47, 80]) {
          for (let t = 0; t < 200; t++) {
            for (const row of anim.frame(t, cols)) {
              expect(row.length).toBe(cols);
            }
          }
        }
      });
    });
  }
});

describe("animate: duck pond", () => {
  const duck = findAnimation("duck")!;

  it("shows the duck from the very first frame", () => {
    // A single-frame render (the non-tty default) must not be an empty pond.
    const grid = duck.frame(0, 80).join("\n");
    expect(grid).toContain("Y"); // body
    expect(grid).toContain("O"); // beak
    expect(grid).toContain("K"); // eye
  });

  it("paddles leftward over time", () => {
    // Column of the beak, wherever the bob has put its row.
    const beakAt = (t: number) =>
      Math.max(...duck.frame(t, 80).map((row) => row.indexOf("OO")));
    expect(beakAt(10)).toBeGreaterThan(-1);
    expect(beakAt(10)).toBeLessThan(beakAt(0));
  });

  it("layers the water from surface to depth", () => {
    const grid = duck.frame(0, 80);
    expect(grid[9]).toContain("w"); // surface
    expect(grid[10]).toContain("b"); // mid
    expect(grid[15]).toContain("z"); // deepest
  });

  it("the surface keeps moving", () => {
    const duckless = (t: number) => duck.frame(t, 80)[9]!.slice(0, 40);
    expect(duckless(0)).not.toBe(duckless(2));
  });

  it("blinks now and then", () => {
    const eyes = Array.from({ length: 40 }, (_, t) =>
      duck.frame(t, 80).join("\n").includes("K"),
    );
    expect(eyes.some((open) => !open)).toBe(true);
    expect(eyes.some((open) => open)).toBe(true);
  });
});

describe("animate: egg hatch", () => {
  const egg = findAnimation("egg")!;
  const grid = (t: number) => egg.frame(t, 80).join("\n");

  it("starts as an intact egg, no duckling in sight", () => {
    expect(grid(0)).toContain("E");
    expect(grid(0)).not.toContain("Y");
  });

  it("cracks before it hatches", () => {
    // Crack pixels (K) on the shell, but still no duckling.
    const rows = egg.frame(30, 80);
    const shellRows = rows.slice(6, 12).join("\n");
    expect(shellRows).toContain("K");
    expect(grid(30)).not.toContain("Y");
  });

  it("hatches: duckling and broken shell share the frame", () => {
    const late = grid(80);
    expect(late).toContain("Y"); // duckling
    expect(late).toContain("O"); // its beak
    expect(late).toContain("E"); // leftover shell
  });

  it("the story replays every cycle", () => {
    // Same phase one cycle later: egg intact again, duckling gone.
    expect(grid(96)).not.toContain("Y");
    expect(grid(96)).toContain("E");
  });
});

describe("animate: rendering", () => {
  const duck = findAnimation("duck")!;

  it("renderColor: half-blocks with 256-color fg/bg, one line per pixel pair", () => {
    const grid = duck.frame(0, 40);
    const lines = renderColor(grid);
    expect(lines.length).toBe(grid.length / 2);
    for (const line of lines) {
      expect(line).toContain("▀");
      expect(line).toContain("\x1b[38;5;");
      expect(line).toContain(";48;5;");
      expect(line.endsWith("\x1b[0m")).toBe(true);
    }
  });

  it("renderPlain: no escape codes, duck and water still recognizable", () => {
    const text = renderPlain(duck.frame(0, 40)).join("\n");
    expect(text).not.toContain("\x1b[");
    expect(text).toContain("#"); // duck body
    expect(text).toContain("~"); // water
  });
});

describe("animate: play", () => {
  const duck = findAnimation("duck")!;
  const capture = () => {
    const chunks: string[] = [];
    return { chunks, write: (s: string) => chunks.push(s) };
  };

  it("non-tty plain: frames only, no escape codes", async () => {
    const out = capture();
    await play(duck, {
      cols: 40,
      frames: 2,
      delayMs: 0,
      tty: false,
      color: false,
      out,
    });
    const text = out.chunks.join("");
    expect(text).not.toContain("\x1b[");
    expect(text).toContain("~");
  });

  it("tty color: hides the cursor, redraws in place, restores the cursor", async () => {
    const out = capture();
    await play(duck, {
      cols: 40,
      frames: 3,
      delayMs: 0,
      tty: true,
      color: true,
      out,
    });
    const text = out.chunks.join("");
    expect(text.startsWith("\x1b[?25l")).toBe(true);
    expect(text).toContain("\x1b[8A"); // 16 pixel rows -> 8 lines
    expect(text).toContain("▀");
    expect(text.endsWith("\x1b[?25h")).toBe(true);
  });
});

describe("cli: wt animate (easter egg)", () => {
  beforeAll(() => {
    if (!existsSync(BIN)) {
      throw new Error(`bin/wt not built at ${BIN} — run "bun run build" first`);
    }
  });

  it("--list names the animations", async () => {
    const r = await runCli(BIN, ["animate", "--list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("duck");
    expect(r.stdout).toContain("crab");
    expect(r.stdout).toContain("egg");
  });

  it("animate2 plays the egg and honors flags", async () => {
    const r = await runCli(BIN, ["animate2", "--frames", "1"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("O"); // eggshell in the plain fallback
    expect(r.stdout).toContain(","); // grass
  });

  it("defaults to a single plain duck frame when stdout is not a tty", async () => {
    const r = await runCli(BIN, ["animate"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("\x1b[");
    expect(r.stdout).toContain("~");
    expect(r.stdout).toContain("#");
  });

  it("--color forces half-block color output", async () => {
    const r = await runCli(BIN, ["animate", "duck", "--frames", "2", "--color"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("▀");
    expect(r.stdout).toContain("\x1b[38;5;");
  });

  it("NO_COLOR wins over --color", async () => {
    const r = await runCli(BIN, ["animate", "--color"], {
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("\x1b[");
  });

  it("rejects unknown animations", async () => {
    const r = await runCli(BIN, ["animate", "goose"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("unknown animation");
  });

  it("rejects a bad --frames value", async () => {
    const r = await runCli(BIN, ["animate", "duck", "--frames", "zero"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--frames");
  });

  it("stays out of --help (animate2 included)", async () => {
    const r = await runCli(BIN, ["--help"]);
    expect(r.stdout).not.toContain("animate");
  });
});
