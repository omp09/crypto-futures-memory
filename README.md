# Crypto Futures Memory

Hourly collector for Market Memory and Sector Memory.

## Run locally

```bash
npm install
npm test
npm run collect
```

## Data files

- `data/snapshot-history.json` stores BTC/ETH market memory snapshots.
- `data/sector-history.json` stores sector memory snapshots.
- `data/sector-registry.json` defines active sector membership.

## GitHub Actions

`.github/workflows/collect-memory.yml` runs once per hour and commits updated memory files back to the default branch using the built-in `GITHUB_TOKEN` with `contents: write`.

The collector keeps 14 days of history by default. Override with `MEMORY_RETENTION_DAYS`.
