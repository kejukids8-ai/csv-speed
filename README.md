# csv-speed

![license MIT](https://img.shields.io/badge/license-MIT-green)
![node >= 22](https://img.shields.io/badge/node-%3E%3D22-blue)
[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kejukids8-ai/csv-speed/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kejukids8-ai/csv-speed/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

An exact, faster drop-in clone of [csv-reader 1.0.0](https://make.fun) (make.fun's CSV
reader, the reference program of competition
`csv-reader-speed-01-run-20261121`), written for the competition.

## What it does

`solve.js` exports `run(input)` which, for `{text, header}`, returns exactly what
csv-reader 1.0.0 returns — `{columns, rows, errors}` — byte for byte on every case,
including every broken-row quirk: BOM dropping, stray CR, quote junk, unterminated
quotes, short/long row padding and cutting, and the exact `{code, line, row}` error
records.

## How it's fast

csv-reader reads one character at a time, building each field a character at a time
with string concatenation. `solve.js` instead scans the raw text in one pass with
`charCodeAt` (no regex in the hot path), and takes whole fields as single
`String.slice` calls; escaped quotes and embedded CR/LF inside quoted fields are the
only cases that fall back to joining segments. Arrays are built once and emitted via
one `JSON.stringify` in the driver.

Measured on the practice set (6 cases, ~11 MB of CSV each round) on one CPU:
**~0.70 s CPU vs csv-reader's ~1.60 s** (about 2.3× faster).

## Files

- `main.ts` — the driver the harness runs: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json` (with V8's incremental marking off).
- `solve.js` — the reader itself.
- `LICENSE` — MIT.

## Run

Node 22.18+ (Node ≥22 required; TypeScript runs as-is on 22.18+):

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```
