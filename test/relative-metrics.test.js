import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SnapshotHistoryStore } from "../src/history-store.js";
import { buildRelativeMetricsBlock } from "../src/relative-metrics.js";

test("relative metrics show not enough history when lookbacks are missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-relative-"));
  const historyStore = new SnapshotHistoryStore({
    filePath: path.join(tempDir, "snapshot-history.json"),
  });

  try {
    await historyStore.recordSnapshots([
      sampleSnapshot("2026-06-08T00:00:00.000Z", "BTCUSDT"),
      sampleSnapshot("2026-06-08T00:00:00.000Z", "ETHUSDT"),
    ]);

    const block = await buildRelativeMetricsBlock({
      states: [sampleMarketState("BTCUSDT", 1), sampleMarketState("ETHUSDT", 3)],
      historyStore,
    });

    assert.match(block, /Relative Metrics/);
    assert.match(block, /Leverage Expansion Ratio:\nNot enough history yet./);
    assert.match(block, /ETH Relative Strength:\n\+2.0%/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relative metrics calculate selected ratios from history", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-relative-"));
  const historyStore = new SnapshotHistoryStore({
    filePath: path.join(tempDir, "snapshot-history.json"),
  });

  try {
    await historyStore.recordSnapshots([
      sampleSnapshot("2026-06-07T00:00:00.000Z", "BTCUSDT", {
        price: 80,
        funding: 0.0001,
        open_interest: 800,
        volume: 5000,
        basis: 0.001,
      }),
      sampleSnapshot("2026-06-07T18:00:00.000Z", "BTCUSDT", {
        price: 90,
        funding: 0.0002,
        open_interest: 900,
        volume: 7000,
        basis: 0.002,
      }),
      sampleSnapshot("2026-06-07T23:00:00.000Z", "BTCUSDT", {
        price: 95,
        funding: 0.0003,
        open_interest: 1000,
        volume: 10000,
        basis: 0.003,
      }),
      sampleSnapshot("2026-06-08T00:00:00.000Z", "BTCUSDT", {
        price: 100,
        funding: 0.0004,
        open_interest: 1120,
        volume: 9000,
        basis: 0.004,
      }),
    ]);

    const block = await buildRelativeMetricsBlock({
      states: [sampleMarketState("BTCUSDT", 1), sampleMarketState("ETHUSDT", 4)],
      historyStore,
    });

    assert.match(block, /Leverage Expansion Ratio:\n2.2x/);
    assert.match(block, /Volume Expansion:\n1.8x/);
    assert.match(block, /ETH Relative Strength:\n\+3.0%/);
    assert.match(block, /Funding Momentum:\n\+2.00bps/);
    assert.match(block, /Basis Drift:\n\+10.00bps/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function sampleSnapshot(timestamp, symbol, overrides = {}) {
  return {
    timestamp,
    symbol,
    price: overrides.price ?? 100,
    funding: overrides.funding ?? 0.0001,
    open_interest: overrides.open_interest ?? 1000,
    volume: overrides.volume ?? 10000,
    basis: overrides.basis ?? 0.001,
  };
}

function sampleMarketState(symbol, priceChangePercent) {
  return {
    symbol,
    priceChangePercent,
  };
}
