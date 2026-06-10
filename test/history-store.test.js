import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  renderComparisonFacts,
  renderHistoryDebug,
  SnapshotHistoryStore,
  toHistorySnapshot,
} from "../src/history-store.js";

test("records snapshots to disk and reloads after restart", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-history-"));
  const filePath = path.join(tempDir, "snapshot-history.json");

  try {
    const store = new SnapshotHistoryStore({ filePath });
    await store.recordSnapshots([
      sampleSnapshot("2026-06-08T00:00:00.000Z", "BTCUSDT", {
        price: 100,
        funding: 0.0001,
        open_interest: 1000,
        volume: 10000,
        basis: 0.001,
      }),
    ]);

    const raw = await readFile(filePath, "utf8");
    assert.match(raw, /BTCUSDT/);

    const restartedStore = new SnapshotHistoryStore({ filePath });
    const debug = await restartedStore.describeHistory("BTCUSDT");
    assert.equal(debug.count, 1);
    assert.equal(debug.first.symbol, "BTCUSDT");
    assert.equal(debug.last.price, 100);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("keeps one snapshot per symbol per hour", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-history-"));
  const filePath = path.join(tempDir, "snapshot-history.json");

  try {
    const store = new SnapshotHistoryStore({ filePath });
    await store.recordSnapshots([
      sampleSnapshot("2026-06-08T00:10:00.000Z", "BTCUSDT", { price: 100 }),
      sampleSnapshot("2026-06-08T00:50:00.000Z", "BTCUSDT", { price: 110 }),
    ]);

    const debug = await store.describeHistory("BTCUSDT");
    assert.equal(debug.count, 1);
    assert.equal(debug.last.price, 110);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("compares current snapshot against 1h, 6h, and 24h lookbacks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-history-"));
  const filePath = path.join(tempDir, "snapshot-history.json");

  try {
    const store = new SnapshotHistoryStore({ filePath });
    await store.recordSnapshots([
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

    const comparison = await store.compare("BTCUSDT");
    assert.equal(comparison.comparisons.length, 3);
    assert.equal(comparison.comparisons[0].label, "1h");
    assert.match(comparison.comparisons[0].facts.join("\n"), /OI \+12.0% מאז 1h/);
    assert.match(comparison.comparisons[1].facts.join("\n"), /Funding \+100.0% מאז 6h/);
    assert.match(comparison.comparisons[2].facts.join("\n"), /Volume פי 1.8/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("renders history debug and converts market state to history snapshot", () => {
  const snapshot = toHistorySnapshot(
    {
      symbol: "ETHUSDT",
      lastPrice: 200,
      lastFundingRate: 0.0002,
      openInterest: 3000,
      quoteVolume: 40000,
      markPrice: 201,
      indexPrice: 200,
    },
    new Date("2026-06-08T00:00:00.000Z"),
  );

  assert.deepEqual(snapshot, {
    timestamp: "2026-06-08T00:00:00.000Z",
    symbol: "ETHUSDT",
    price: 200,
    funding: 0.0002,
    open_interest: 3000,
    volume: 40000,
    basis: 0.005,
  });

  const debugText = renderHistoryDebug({
    symbol: "ETHUSDT",
    count: 1,
    first: snapshot,
    last: snapshot,
    availability: [
      { label: "1h", available: false },
      { label: "6h", available: false },
      { label: "24h", available: false },
    ],
  });
  assert.match(debugText, /Snapshots: 1/);
  assert.match(debugText, /1h: אין מספיק מידע/);

  const comparisonText = renderComparisonFacts({
    symbol: "ETHUSDT",
    current: null,
    comparisons: [],
  });
  assert.match(comparisonText, /אין היסטוריה/);
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
