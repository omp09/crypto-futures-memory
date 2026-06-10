import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RETENTION_DAYS = 14;
const retentionDays = Number(process.env.MEMORY_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);

const files = {
  market: path.resolve(__dirname, "../data/snapshot-history.json"),
  sector: path.resolve(__dirname, "../data/sector-history.json"),
};

await collectMemory();

async function collectMemory() {
  const app = createApp();

  console.log("Collecting Market Memory...");
  await app.recordHourlySnapshots();

  console.log("Collecting Sector Memory...");
  await app.recordHourlySectorSnapshots();

  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    await pruneHistoryFile(files.market, retentionDays);
    await pruneHistoryFile(files.sector, retentionDays);
  }

  const market = await loadHistory(files.market);
  const sector = await loadHistory(files.sector);

  console.log(
    JSON.stringify(
      {
        ok: true,
        retention_days: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : "disabled",
        market_snapshots: market.snapshots.length,
        sector_snapshots: sector.snapshots.length,
        market_last: market.snapshots.at(-1)?.timestamp ?? null,
        sector_last: sector.snapshots.at(-1)?.timestamp ?? null,
      },
      null,
      2,
    ),
  );
}

async function pruneHistoryFile(filePath, days) {
  const history = await loadHistory(filePath);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const snapshots = history.snapshots.filter((snapshot) => {
    const timestamp = new Date(snapshot.timestamp).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });

  if (snapshots.length !== history.snapshots.length) {
    await writeFile(filePath, `${JSON.stringify({ snapshots }, null, 2)}\n`);
  }
}

async function loadHistory(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { snapshots: [] };
    }
    throw error;
  }
}
