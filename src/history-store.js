import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const HOUR_MS = 60 * 60 * 1000;
const LOOKBACKS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
];

export class SnapshotHistoryStore {
  constructor({ filePath, now = () => new Date() }) {
    this.filePath = filePath;
    this.now = now;
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

  async describeHistory(symbol) {
    const normalizedSymbol = symbol.toUpperCase();
    const history = await this.load();
    const symbolSnapshots = history.snapshots
      .filter((snapshot) => snapshot.symbol === normalizedSymbol)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const first = symbolSnapshots.at(0) ?? null;
    const last = symbolSnapshots.at(-1) ?? null;
    const availability = last
      ? LOOKBACKS.map(({ label, hours }) => ({
          label,
          available: Boolean(findSnapshotAtOrBefore(symbolSnapshots, new Date(last.timestamp), hours)),
        }))
      : LOOKBACKS.map(({ label }) => ({ label, available: false }));

    return {
      symbol: normalizedSymbol,
      count: symbolSnapshots.length,
      first,
      last,
      availability,
    };
  }

  async compare(symbol) {
    const normalizedSymbol = symbol.toUpperCase();
    const history = await this.load();
    const symbolSnapshots = history.snapshots
      .filter((snapshot) => snapshot.symbol === normalizedSymbol)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const current = symbolSnapshots.at(-1) ?? null;

    if (!current) {
      return { symbol: normalizedSymbol, current: null, comparisons: [] };
    }

    return {
      symbol: normalizedSymbol,
      current,
      comparisons: LOOKBACKS.map(({ label, hours }) => {
        const previous = findSnapshotAtOrBefore(symbolSnapshots, new Date(current.timestamp), hours);
        return {
          label,
          hours,
          previous,
          facts: previous ? buildComparisonFacts(current, previous, label) : [],
        };
      }),
    };
  }
}

export function toHistorySnapshot(state, timestamp = new Date()) {
  return {
    timestamp: timestamp.toISOString(),
    symbol: state.symbol,
    price: state.lastPrice,
    funding: state.lastFundingRate,
    open_interest: state.openInterest,
    volume: state.quoteVolume,
    basis: calculateBasis(state),
  };
}

export function renderHistoryDebug(debug) {
  const first = debug.first ? compactSnapshot(debug.first) : "אין";
  const last = debug.last ? compactSnapshot(debug.last) : "אין";
  const availability = debug.availability
    .map((item) => `${item.label}: ${item.available ? "יש מספיק מידע" : "אין מספיק מידע"}`)
    .join("\n");

  return [
    `History ${debug.symbol}`,
    `Snapshots: ${debug.count}`,
    `First: ${first}`,
    `Last: ${last}`,
    "",
    availability,
  ].join("\n");
}

export function renderComparisonFacts(comparison) {
  if (!comparison.current) {
    return `אין היסטוריה עבור ${comparison.symbol}.`;
  }

  return comparison.comparisons
    .map((item) => {
      if (!item.previous) {
        return `${item.label}: אין מספיק מידע להשוואה.`;
      }
      return [`${item.label}:`, ...item.facts.map((fact) => `- ${fact}`)].join("\n");
    })
    .join("\n\n");
}

function upsertHourlySnapshot(snapshots, snapshot) {
  const hourKey = getHourKey(snapshot.timestamp);
  const existingIndex = snapshots.findIndex(
    (item) => item.symbol === snapshot.symbol && getHourKey(item.timestamp) === hourKey,
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

function buildComparisonFacts(current, previous, label) {
  const volumeAverageText =
    label === "24h"
      ? `Volume ${formatMultiplier(current.volume, previous.volume)} מהממוצע/נקודת הייחוס של 24 שעות`
      : `Volume ${formatPercentChange(current.volume, previous.volume)} מאז ${label}`;

  return [
    `Price ${formatPercentChange(current.price, previous.price)} מאז ${label}`,
    `Funding ${formatPercentChange(current.funding, previous.funding)} מאז ${label}`,
    `OI ${formatPercentChange(current.open_interest, previous.open_interest)} מאז ${label}`,
    volumeAverageText,
    `Basis ${formatPercentChange(current.basis, previous.basis)} מאז ${label}`,
  ];
}

function compactSnapshot(snapshot) {
  return `${snapshot.timestamp} price=${formatNumber(snapshot.price)} funding=${formatNumber(snapshot.funding)} oi=${formatNumber(snapshot.open_interest)} volume=${formatNumber(snapshot.volume)} basis=${formatNumber(snapshot.basis)}`;
}

function calculateBasis(state) {
  if (!state.indexPrice) {
    return 0;
  }
  return (state.markPrice - state.indexPrice) / state.indexPrice;
}

function getHourKey(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function formatPercentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return "לא ניתן לחשב";
  }
  const value = ((current - previous) / Math.abs(previous)) * 100;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatMultiplier(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return "לא ניתן לחשב";
  }
  return `פי ${(current / previous).toFixed(1)}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return Number(value.toPrecision(8)).toString();
}
