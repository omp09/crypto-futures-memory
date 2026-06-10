import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { SectorHistoryStore } from "../src/sector-history-store.js";
import {
  buildSectorRelativeMetrics,
  calculateSectorRanks,
} from "../src/sector-relative-metrics.js";

test("calculates relative strength, breadth change, rank change, and participation", () => {
  const sectorHistory = {
    snapshots: [
      sampleSector("2026-06-07T00:00:00.000Z", "ai", "AI", {
        average_return: -0.5,
        positive: 2,
      }),
      sampleSector("2026-06-07T00:00:00.000Z", "memes", "Memes", {
        average_return: 2.5,
        positive: 5,
      }),
      sampleSector("2026-06-07T23:00:00.000Z", "ai", "AI", {
        average_return: 1.2,
        positive: 5,
        leaders: ["TAO", "RNDR", "FET"],
      }),
      sampleSector("2026-06-07T23:00:00.000Z", "memes", "Memes", {
        average_return: 3.0,
        positive: 6,
      }),
      sampleSector("2026-06-08T00:00:00.000Z", "ai", "AI", {
        average_return: 3.4,
        positive: 8,
        leaders: ["TAO", "RNDR", "WLD"],
      }),
      sampleSector("2026-06-08T00:00:00.000Z", "memes", "Memes", {
        average_return: 1.0,
        positive: 4,
      }),
    ],
  };

  const output = buildSectorRelativeMetrics({
    sectorName: "AI",
    sectorHistory,
    btcState: { symbol: "BTCUSDT", priceChangePercent: -0.8 },
  });

  assert.match(output, /\+4.2% vs BTC/);
  assert.match(output, /\+1.2% vs Market/);
  assert.match(output, /1h: 5\/10 -> 8\/10/);
  assert.match(output, /24h: 2\/10 -> 8\/10/);
  assert.match(output, /1h: #2 -> #1/);
  assert.match(output, /Participation:\nImproving/);
  assert.match(output, /Leader Stability:\n0 of top 3 leaders remained/);
});

test("calculates sector ranks for a timestamp", () => {
  const ranks = calculateSectorRanks(
    [
      sampleSector("2026-06-08T00:00:00.000Z", "ai", "AI", { average_return: 3 }),
      sampleSector("2026-06-08T00:00:00.000Z", "memes", "Memes", { average_return: 5 }),
      sampleSector("2026-06-08T00:00:00.000Z", "defi", "DeFi", { average_return: -1 }),
    ],
    "2026-06-08T00:00:00.000Z",
  );

  assert.equal(ranks.get("memes"), 1);
  assert.equal(ranks.get("ai"), 2);
  assert.equal(ranks.get("defi"), 3);
});

test("/sector-metrics command returns relative metrics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sector-metrics-app-"));
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
      {
        id: "memes",
        name: "Memes",
        status: "active",
        members: [{ symbol: "DOGEUSDT" }, { symbol: "PEPEUSDT" }, { symbol: "WIFUSDT" }],
      },
    ],
  };

  try {
    await sectorHistoryStore.recordSnapshots([
      sampleSector("2026-06-07T23:00:00.000Z", "ai", "AI", {
        average_return: 1,
        positive: 1,
        leaders: ["TAO", "FET", "RNDR"],
      }),
      sampleSector("2026-06-07T23:00:00.000Z", "memes", "Memes", {
        average_return: 3,
        positive: 2,
      }),
    ]);
    const app = createApp({
      sectorRegistry: registry,
      sectorHistoryStore,
      fetchMarketStates: async (symbols) =>
        symbols.map((symbol) => {
          if (symbol === "BTCUSDT") {
            return sampleMarketState(symbol, 0.5);
          }
          if (symbol === "DOGEUSDT") {
            return sampleMarketState(symbol, 1);
          }
          if (symbol === "PEPEUSDT") {
            return sampleMarketState(symbol, -1);
          }
          if (symbol === "WIFUSDT") {
            return sampleMarketState(symbol, -1);
          }
          return sampleMarketState(symbol, 4);
        }),
    });

    const response = await app.handleText("/sector-metrics AI");

    assert.match(response, /AI/);
    assert.match(response, /Relative Strength:/);
    assert.match(response, /Breadth:/);
    assert.match(response, /Rank:/);
    assert.match(response, /Participation:/);
    assert.match(response, /Leader Stability:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function sampleSector(timestamp, sector_id, sector_name, overrides = {}) {
  const positive = overrides.positive ?? 5;
  const available = overrides.available ?? 10;
  return {
    timestamp,
    sector_id,
    sector_name,
    breadth: {
      positive,
      available,
      ratio: positive / available,
    },
    average_return: overrides.average_return ?? 1,
    median_return: overrides.median_return ?? 0.8,
    label: overrides.label ?? "Improving",
    leaders: overrides.leaders ?? ["A", "B", "C"],
    available_assets: available,
  };
}

function sampleMarketState(symbol, priceChangePercent) {
  return {
    symbol,
    priceChangePercent,
    quoteVolume: 10000,
    latestQuoteVolume: 1000,
    averageQuoteVolume: 900,
  };
}
