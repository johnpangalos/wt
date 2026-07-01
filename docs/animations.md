# `wt animate` — easter-egg animations

`wt animate` is a hidden command (deliberately absent from `--help`) that plays
little 8-bit-style pixel animations in the terminal, in the spirit of the
Claude crab: a pure frame renderer redrawn in place with ANSI cursor movements.

## Usage

```
wt animate                 play the default animation (duck) until Ctrl-C
wt animate <name>          play a specific animation
wt animate --list          list available animations
wt animate --frames <n>    render n frames and exit (also the non-tty default: 1)
wt animate --color         force color output when stdout is not a tty
wt animate2                the sequel: play the egg hatch (same flags)
```

`NO_COLOR` disables color everywhere and wins over `--color`.

## How it works

Each animation in `src/animate.ts` is a pure function `frame(tick, cols)` that
returns a pixel grid: rows of single-char palette keys, two pixel rows per
terminal line. Purity keeps frames deterministic and unit-testable
(`tests/animate.test.ts`).

Rendering uses the half-block trick: every pair of pixel rows becomes one text
line of `▀` characters, with the 256-color foreground painting the top pixel
and the background painting the bottom pixel. That doubles the vertical
resolution and makes each cell an addressable colored "pixel". The player hides
the cursor (`ESC[?25l`), writes a frame with erase-to-EOL per line, moves the
cursor back up (`ESC[<h>A`), and redraws — restoring the cursor on exit or
Ctrl-C. Without a color terminal it falls back to one plain character per
pixel pair.

Adding an animation = draw sprites as palette-key strings, write a `frame`
function that fills a grid and `stamp`s the sprites on ("." is transparent),
and add an entry to `ANIMATIONS`.

## Current animations

- **duck** — a yellow duck with an orange beak paddling left across a pond:
  four depth-shaded water layers with wave crests and highlight streaks
  drifting right at different speeds (parallax), a trailing wake, a bobbing
  float, an occasional blink, a lily pad riding the drift, sun and cloud in
  the sky.
- **crab** — a red crab scuttling along the beach below the sea horizon,
  snapping its claws. A small nod to the Claude crab.
- **egg** (also `wt animate2`) — a 96-tick hatching story on a grassy meadow:
  the egg wobbles, cracks spread, the top of the shell pops off, and a
  duckling climbs out and waddles away flapping, then the story replays.

## Ideas for future animations

- **koi** — a fish gliding beneath the duck's pond, surfacing for a splash.
- **rain** — rain streaking down the frame with puddle ripples at the bottom.
- **train** — a steam train crossing with scrolling smoke puffs (classic `sl`
  homage; could trigger on a mistyped `wt ls`).
- **campfire** — flickering flames with drifting sparks; a calm idle screen.
- **ducklings** — the duck again, but trailed by a wobbling line of ducklings
  that fall out of formation and catch up.
- **night mode** — the same pond by moonlight: darker palette, stars, and the
  duck asleep with its head tucked back.
- **truecolor** — upgrade the palette to 24-bit (`38;2;r;g;b`) with dithered
  gradients where the terminal supports it.
- **seasonal** — pick the default animation by date (snow in December, etc.).
- **worktree tie-in** — one duckling per worktree in the current repo, so the
  pond doubles as a whimsical `wt list`.
