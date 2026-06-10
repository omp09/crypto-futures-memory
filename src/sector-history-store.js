import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const HOUR_MS = 60 * 60 * 1000;
const LOOKBACKS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
];

export class SectorHistoryStore {
  constructor({ filePath }) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
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

  async save(history) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(history, null, 2)}\n`);
  }

  async recordSnapshots(snapshots) {
    const history = await this.load();
    for (const snapshot of snapshots) {
      upsertHourlySnapshot(history.snapshots, snapshot);
    }
    history.snapshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    await this.save(history);
    return history;
  }

  async describeHistory(sectorIdOrName) {
    const history = await this.load();
    const sectorSnapshots = filterSectorSnapshots(history.snapshots, sectorIdOrName);
    const first = sectorSnapshots.at(0) ?? null;
    const last = sectorSnapshots.at(-1) ?? null;
    const availability = last
      ? LOOKBACKS.map(({ label, hours }) => ({
          label,
          available: Boolean(findSnapshotAtOrBefore(sectorSnapshots, new Date(last.timestamp), hours)),
        }))
      : LOOKBACKS.map(({ label }) => ({ label, available: false }));

    return {
      sector: last?.sector_name ?? first?.sector_name ?? sectorIdOrName,
      count: sectorSnapshots.length,
      first,
      last,
      availability,
    };
  }

  async compare(sectorIdOrName) {
    const history = await this.load();
    const sectorSnapshots = filterSectorSnapshots(history.snapshots, sectorIdOrName);
    const current = sectorSnapshots.at(-1) ?? null;

    if (!current) {
      return { sector: sectorIdOrName, current: null, comparisons: [] };
    }

    return {
      sector: current.sector_name,
      current,
      comparisons: LOOKBACKS.map(({ label, hours }) => {
        const previous = findSnapshotAtOrBefore(sectorSnapshots, new Date(current.timestamp), hours);
        return {
          label,
          hours,
          previous,
          facts: previous ? buildComparisonFacts(current, previous) : [],
        };
      }),
    };
  }
}

export function toSectorHistorySnapshot(snapshot, timestamp = new Date()) {
  return {
    timestamp: timestamp.toISOString(),
    sector_id: snapshot.id,
    sector_name: snapshot.name,
    breadth: {
      positive: snapshot.positiveCount,
      available: snapshot.availableAssets,
      ratio: snapshot.breadthRatio,
    },
    average_return: snapshot.averageReturn,
    median_return: snapshot.medianReturn,
    label: snapshot.label,
    leaders: snapshot.leaders.map((leader) => leader.asset),
    available_assets: snapshot.availableAssets,
  };
}

export function renderSectorHistoryDebug(debug, comparison) {
  if (!debug.last) {
    return `${debug.sector}\n\nSnapshots: 0\n\nNo sector history available yet.`;
  }

  return [
    debug.sector,
    "",
    `Snapshots: ${debug.count}`,
    "",
    ...comparison.comparisons.flatMap((item) => renderComparison(item, comparison.current)),
  ].join("\n");
}

function renderComparison(item, current) {
  if (!item.previous) {
    return [item.label + ":", "Not enough history yet.", ""];
  }

  return [
    item.label + ":",
    `Breadth: ${formatBreadth(item.previous)} -> ${formatBreadth(current)}`,
    `Average Return: ${formatPercent(item.previous.average_return)} -> ${formatPercent(current.average_return)}`,
    "",
  ];
}

function buildComparisonFacts(current, previous) {
  return [
    `Breadth: ${formatBreadth(previous)} -> ${formatBreadth(current)}`,
    `Average Return: ${formatPercent(previous.average_return)} -> ${formatPercent(current.average_return)}`,
    `Median Return: ${formatPercent(previous.median_return)} -> ${formatPercent(current.median_return)}`,
    `Label: ${previous.label} -> ${current.label}`,
  ];
}

function filterSectorSnapshots(snapshots, sectorIdOrName) {
  const normalized = normalize(sectorIdOrName);
  return snapshots
    .filter(
      (snapshot) =>
        normalize(snapshot.sector_id) === normalized || normalize(snapshot.sector_name) === normalized,
    )
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function upsertHourlySnapshot(snapshots, snapshot) {
  const hourKey = getHourKey(snapshot.timestamp);
  const existingIndex = snapshots.findIndex(
    (item) => item.sector_id === snapshot.sector_id && getHourKey(item.timestamp) === hourKey,
  );

  if (existingIndex === -1) {
    snapshots.push(snapshot);
    return;
  }

  snapshots[existingIndex] = snapshot;
}

function findSnapshotAtOrBefore(snapshots, currentDate, hoursAgo) {
  const targetTime = currentDate.getTime() - hoursAgo * HOUR_MS;
  const toleranceMs = 70 * 60 * 1000;

  return [...snapshots]
    .filter((snapshot) => {
      const snapshotTime = new Date(snapshot.timestamp).getTime();
      return snapshotTime <= targetTime && targetTime - snapshotTime <= toleranceMs;
    })
    .at(-1);
}

function getHourKey(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function formatBreadth(snapshot) {
  return `${snapshot.breadth.positive}/${snapshot.breadth.available}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
