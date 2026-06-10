import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { SnapshotHistoryStore } from "../src/history-store.js";
import { SectorHistoryStore } from "../src/sector-history-store.js";

test("/history command returns snapshot debug and comparison availability", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-app-"));
  const historyStore = new SnapshotHistoryStore({
    filePath: path.join(tempDir, "snapshot-history.json"),
  });

  try {
    await historyStore.recordSnapshots([
      sampleSnapshot("2026-06-07T00:00:00.000Z", "BTCUSDT"),
      sampleSnapshot("2026-06-07T18:00:00.000Z", "BTCUSDT"),
      sampleSnapshot("2026-06-07T23:00:00.000Z", "BTCUSDT"),
      sampleSnapshot("2026-06-08T00:00:00.000Z", "BTCUSDT"),
    ]);

    const app = createApp({
      historyStore,
      fetchMarketStates: async () => [],
    });
    const response = await app.handleText("/history BTCUSDT");

    assert.match(response, /History BTCUSDT/);
    assert.match(response, /Snapshots: 4/);
    assert.match(response, /1h: יש מספיק מידע/);
    assert.match(response, /6h: יש מספיק מידע/);
    assert.match(response, /24h: יש מספיק מידע/);
    assert.match(response, /OI 0.0% מאז 1h/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("/market records snapshots for BTC and ETH", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-app-"));
  const historyStore = new SnapshotHistoryStore({
    filePath: path.join(tempDir, "snapshot-history.json"),
  });

  try {
    const app = createApp({
      historyStore,
      fetchMarketStates: async () => [
        sampleMarketState("BTCUSDT"),
        sampleMarketState("ETHUSDT"),
        sampleMarketState("SOLUSDT"),
      ],
    });

    const response = await app.handleText("/market");
    const btcDebug = await historyStore.describeHistory("BTCUSDT");
    const ethDebug = await historyStore.describeHistory("ETHUSDT");
    const solDebug = await historyStore.describeHistory("SOLUSDT");

    assert.match(response, /Relative Metrics/);
    assert.equal(btcDebug.count, 1);
    assert.equal(ethDebug.count, 1);
    assert.equal(solDebug.count, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("hourly sector collection records sector snapshots without Telegram commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-sector-auto-"));
  const sectorHistoryStore = new SectorHistoryStore({
    filePath: path.join(tempDir, "sector-history.json"),
  });
  const registry = {
    version: 1,
    sectors: [
      {
        id: "ai",
        name: "AI",
        status: "active",
        members: [{ symbol: "TAOUSDT" }, { symbol: "FETUSDT" }, { symbol: "RNDRUSDT" }],
      },
    ],
  };

  try {
    const app = createApp({
      sectorRegistry: registry,
      sectorHistoryStore,
      fetchMarketStates: async (symbols) => symbols.map((symbol) => sampleMarketState(symbol)),
    });

    await app.recordHourlySectorSnapshots();
    const debug = await sectorHistoryStore.describeHistory("AI");

    assert.equal(debug.count, 1);
    assert.equal(debug.last.sector_id, "ai");
    assert.equal(debug.last.breadth.available, 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("hourly market collection records BTC and ETH without Telegram commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crypto-futures-market-auto-"));
  const historyStore = new SnapshotHistoryStore({
    filePath: path.join(tempDir, "snapshot-history.json"),
  });

  try {
    const app = createApp({
      historyStore,
      fetchMarketStates: async () => [
        sampleMarketState("BTCUSDT"),
        sampleMarketState("ETHUSDT"),
        sampleMarketState("SOLUSDT"),
      ],
    });

    await app.recordHourlySnapshots();
    const btcDebug = await historyStore.describeHistory("BTCUSDT");
    const ethDebug = await historyStore.describeHistory("ETHUSDT");
    const solDebug = await historyStore.describeHistory("SOLUSDT");

    assert.equal(btcDebug.count, 1);
    assert.equal(ethDebug.count, 1);
    assert.equal(solDebug.count, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function sampleSnapshot(timestamp, symbol) {
  return {
    timestamp,
    symbol,
    price: 100,
    funding: 0.0001,
    open_interest: 1000,
    volume: 10000,
    basis: 0.001,
  };
}

function sampleMarketState(symbol) {
  return {
    symbol,
    lastPrice: 100,
    priceChangePercent: 0.5,
    volume: 100,
    quoteVolume: 10000,
    markPrice: 100.1,
    indexPrice: 100,
    lastFundingRate: 0.0001,
    openInterest: 1000,
    oneHourChangePercent: 0.1,
    latestQuoteVolume: 1000,
    averageQuoteVolume: 1000,
  };
}
