import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { SectorHistoryStore } from "../src/sector-history-store.js";
import {
  buildSectorSnapshots,
  getRegistrySymbols,
  loadSectorRegistry,
  renderSectorBrief,
} from "../src/sector-intelligence.js";

test("loads sector registry and returns unique symbols", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sector-registry-"));
  const registryPath = path.join(tempDir, "sector-registry.json");

  try {
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 1,
        sectors: [
          {
            id: "ai",
            name: "AI",
            status: "active",
            members: [{ symbol: "TAOUSDT" }, { symbol: "FETUSDT" }],
          },
          {
            id: "old",
            name: "Old",
            status: "deprecated",
            members: [{ symbol: "OLDUSDT" }],
          },
        ],
      }),
    );

    const registry = await loadSectorRegistry(registryPath);
    assert.equal(registry.sectors.length, 1);
    assert.deepEqual(getRegistrySymbols(registry), ["TAOUSDT", "FETUSDT"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("classifies strong and narrow participation sectors", () => {
  const registry = {
    version: 1,
    sectors: [
      {
        id: "ai",
        name: "AI",
        status: "active",
        members: [
          { symbol: "TAOUSDT" },
          { symbol: "FETUSDT" },
          { symbol: "RNDRUSDT" },
          { symbol: "GRTUSDT" },
        ],
      },
      {
        id: "memes",
        name: "Memes",
        status: "active",
        members: [
          { symbol: "DOGEUSDT" },
          { symbol: "PEPEUSDT" },
          { symbol: "WIFUSDT" },
          { symbol: "BONKUSDT" },
        ],
      },
    ],
  };
  const snapshots = buildSectorSnapshots({
    registry,
    states: [
      sampleState("TAOUSDT", 4),
      sampleState("FETUSDT", 3),
      sampleState("RNDRUSDT", 2),
      sampleState("GRTUSDT", -0.5),
      sampleState("DOGEUSDT", 10),
      sampleState("PEPEUSDT", -1),
      sampleState("WIFUSDT", -1),
      sampleState("BONKUSDT", -1),
    ],
  });

  const ai = snapshots.find((snapshot) => snapshot.id === "ai");
  const memes = snapshots.find((snapshot) => snapshot.id === "memes");

  assert.equal(ai.label, "Strong");
  assert.equal(ai.positiveCount, 3);
  assert.equal(ai.availableAssets, 4);
  assert.deepEqual(ai.leaders.map((leader) => leader.asset), ["TAO", "FET", "RNDR"]);
  assert.equal(memes.label, "Narrow Participation");
});

test("renders sector brief", () => {
  const brief = renderSectorBrief([
    {
      name: "AI",
      label: "Strong",
      positiveCount: 3,
      availableAssets: 4,
      leaders: [{ asset: "TAO" }, { asset: "FET" }, { asset: "RNDR" }],
    },
    {
      name: "Memes",
      label: "Narrow Participation",
      positiveCount: 1,
      availableAssets: 4,
      leaders: [{ asset: "DOGE" }],
    },
  ]);

  assert.match(brief, /Sector Intelligence/);
  assert.match(brief, /AI\nStrong\nBreadth: 3\/4 positive\nLeaders: TAO, FET, RNDR/);
  assert.match(brief, /Movement concentrated in a few assets/);
});

test("/sectors command returns sector intelligence brief", async () => {
  const registry = {
    version: 1,
    sectors: [
      {
        id: "iso20022-payments",
        name: "ISO20022 / Payments",
        status: "active",
        members: [
          { symbol: "XRPUSDT" },
          { symbol: "HBARUSDT" },
          { symbol: "XLMUSDT" },
        ],
      },
    ],
  };
  const app = createApp({
    sectorRegistry: registry,
    fetchMarketStates: async (symbols) =>
      symbols.map((symbol, index) => sampleState(symbol, [2, 1, -0.5][index])),
  });

  const response = await app.handleText("/sectors");

  assert.match(response, /Sector Intelligence/);
  assert.match(response, /ISO20022 \/ Payments/);
  assert.match(response, /Breadth: 2\/3 positive/);
  assert.match(response, /Leaders: XRP, HBAR, XLM/);
});

test("/sectors records sector history and /sector-history returns debug", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sector-history-app-"));
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
        members: [
          { symbol: "TAOUSDT" },
          { symbol: "FETUSDT" },
          { symbol: "RNDRUSDT" },
        ],
      },
    ],
  };

  try {
    const app = createApp({
      sectorRegistry: registry,
      sectorHistoryStore,
      fetchMarketStates: async (symbols) =>
        symbols.map((symbol, index) => sampleState(symbol, [3, 2, -1][index])),
    });

    await app.handleText("/sectors");
    const history = await sectorHistoryStore.describeHistory("AI");
    const response = await app.handleText("/sector-history AI");

    assert.equal(history.count, 1);
    assert.match(response, /AI/);
    assert.match(response, /Snapshots: 1/);
    assert.match(response, /1h:\nNot enough history yet./);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function sampleState(symbol, priceChangePercent) {
  return {
    symbol,
    priceChangePercent,
    quoteVolume: 10000,
    latestQuoteVolume: 1000,
    averageQuoteVolume: 900,
  };
}
