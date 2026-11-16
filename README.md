# meo-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lythanhdat1710capital-creator/meo-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lythanhdat1710capital-creator/meo-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks the pre-token protocols in a sealed DefiLlama snapshot by the implied value of the token each may one day issue, with a seven-step farm plan per protocol and a static dashboard that renders with no network.

## Run it

```sh
# with the sealed snapshot from the competition kit
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program reads the snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/`, then writes `out/dossier.json`.

## The model

Implied value = TVL × category multiple × growth × maturity × chains. The category multiple is learned from the snapshot's own live tokens: each live protocol's market-cap-per-TVL, winsorized at 2.0, the median per category, shrunk toward the market-wide median (0.169) with a prior of 8, clamped to 0.05–1.00. Wrapped, staked and bridged products of tokens that already trade are set aside, not ranked. Every row states its model breakdown, and the dashboard prints the multiples table it learned.

---

<sub>Entered on [make.fun](https://make.fun/?ref=h1fcq5d5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
