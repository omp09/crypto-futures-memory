import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  renderSectorHistoryDebug,
  SectorHistoryStore,
  toSectorHistorySnapshot,
} from "../src/sector-history-store.js";

test("saves and loads sector snapshots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sector-history-"));
  const filePath = path.join(tempDir, "sector-history.json");

  try {
    const store = new SectorHistoryStore({ filePath });
    await store.recordSnapshots([sampleHistorySnapshot("2026-06-08T00:00:00.000Z")]);

    const raw = await readFile(filePath, "utf8");
    assert.match(raw, /"sector_id": "ai"/);

    const reloaded = new SectorHistoryStore({ filePath });
    const debug = await reloaded.describeHistory("AI");
    assert.equal(debug.count, 1);
    assert.equal(debug.last.sector_name, "AI");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("compares sector snapshots across 1h, 6h, and 24h", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sector-history-"));
  const filePath = path.join(tempDir, "sector-history.json");

  try {
    const store = new SectorHistoryStore({ filePath });
    await store.recordSnapshots([
      sampleHistorySnapshot("2026-06-07T00:00:00.000Z", { positive: 2, average_return: -0.5 }),
      sampleHistorySnapshot("2026-06-07T18:00:00.000Z", { positive: 4, average_return: 1.2 }),
      sampleHistorySnapshot("2026-06-07T23:00:00.000Z", { positive: 5, average_return: 2.1 }),
      sampleHistorySnapshot("2026-06-08T00:00:00.000Z", { positive: 7, average_return: 3.4 }),
    ]);

    const comparison = await store.compare("AI");
    assert.equal(comparison.comparisons.length, 3);
    assert.match(comparison.comparisons[0].facts.join("\n"), /Breadth: 5\/10 -> 7\/10/);
    assert.match(comparison.comparisons[1].facts.join("\n"), /Average Return: \+1.2% -> \+3.4%/);
    assert.match(comparison.comparisons[2].facts.join("\n"), /Breadth: 2\/10 -> 7\/10/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("renders sector history debug output", () => {
  const current = sampleHistorySnapshot("2026-06-08T00:00:00.000Z", {
    positive: 7,
    average_return: 3.4,
  });
  const previous = sampleHistorySnapshot("2026-06-07T23:00:00.000Z", {
    positive: 5,
    average_return: 1.2,
  });
  const output = renderSectorHistoryDebug(
    {
      sector: "AI",
      count: 2,
      first: previous,
      last: current,
      availability: [],
    },
    {
      sector: "AI",
      current,
      comparisons: [
        { label: "1h", previous, facts: [] },
        { label: "6h", previous: null, facts: [] },
        { label: "24h", previous: null, facts: [] },
      ],
    },
  );

  assert.match(output, /AI/);
  assert.match(output, /Snapshots: 2/);
  assert.match(output, /Breadth: 5\/10 -> 7\/10/);
  assert.match(output, /6h:\nNot enough history yet./);
});

test("converts sector snapshot to history snapshot", () => {
  const historySnapshot = toSectorHistorySnapshot(
    {
      id: "ai",
      name: "AI",
      positiveCount: 7,
      availableAssets: 10,
      breadthRatio: 0.7,
      averageReturn: 3.4,
      medianReturn: 2.8,
      label: "Strong",
      leaders: [{ asset: "TAO" }, { asset: "RNDR" }, { asset: "FET" }],
    },
    new Date("2026-06-08T00:00:00.000Z"),
  );

  assert.deepEqual(historySnapshot, {
    timestamp: "2026-06-08T00:00:00.000Z",
    sector_id: "ai",
    sector_name: "AI",
    breadth: { positive: 7, available: 10, ratio: 0.7 },
    average_return: 3.4,
    median_return: 2.8,
    label: "Strong",
    leaders: ["TAO", "RNDR", "FET"],
    available_assets: 10,
  });
});

function sampleHistorySnapshot(timestamp, overrides = {}) {
  const positive = overrides.positive ?? 7;
  const available = overrides.available ?? 10;
  return {
    timestamp,
    sector_id: "ai",
    sector_name: "AI",
    breadth: {
      positive,
      available,
      ratio: positive / available,
    },
    average_return: overrides.average_return ?? 3.4,
    median_return: overrides.median_return ?? 2.8,
    label: overrides.label ?? "Strong",
    leaders: overrides.leaders ?? ["TAO", "RNDR", "FET"],
    available_assets: available,
  };
}
