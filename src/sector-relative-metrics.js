const LOOKBACK_LABELS = ["1h", "6h", "24h"];

export function buildSectorRelativeMetrics({ sectorName, sectorHistory, btcState }) {
  const target = findSectorHistory(sectorHistory.snapshots, sectorName);
  const current = target.at(-1) ?? null;

  if (!current) {
    return `${sectorName}\n\nNo sector metrics available yet.`;
  }

  const sectorRankings = buildRankingsByLookback(sectorHistory.snapshots, current.timestamp);
  const currentRank = sectorRankings.current.get(current.sector_id) ?? null;
  const marketAverage = average(sectorRankings.currentSnapshots.map((snapshot) => snapshot.average_return));
  const btcRelativeStrength = Number.isFinite(btcState?.priceChangePercent)
    ? current.average_return - btcState.priceChangePercent
    : NaN;
  const comparisons = LOOKBACK_LABELS.map((label) => ({
    label,
    previous: findLookbackSnapshot(target, current.timestamp, label),
    rank: sectorRankings[label].get(current.sector_id) ?? null,
  }));
  const primaryComparison =
    comparisons.find((comparison) => comparison.label === "24h" && comparison.previous) ??
    comparisons.find((comparison) => comparison.previous) ??
    null;

  return [
    current.sector_name,
    "",
    "Relative Strength:",
    `${formatDelta(btcRelativeStrength)} vs BTC`,
    `${formatDelta(current.average_return - marketAverage)} vs Market`,
    "",
    "Breadth:",
    ...comparisons.map((comparison) => renderBreadthLine(comparison, current)),
    "",
    "Rank:",
    ...comparisons.map((comparison) => renderRankLine(comparison, currentRank)),
    "",
    "Participation:",
    primaryComparison ? classifyParticipation(current, primaryComparison.previous) : "Not enough history yet.",
    "",
    "Leader Stability:",
    primaryComparison
      ? `${countStableLeaders(current, primaryComparison.previous)} of top 3 leaders remained`
      : "Not enough history yet.",
  ].join("\n");
}

export function calculateSectorRanks(snapshots, timestamp) {
  return buildRankMap(snapshotsAtHour(snapshots, timestamp));
}

function buildRankingsByLookback(snapshots, currentTimestamp) {
  return {
    currentSnapshots: snapshotsAtHour(snapshots, currentTimestamp),
    current: calculateSectorRanks(snapshots, currentTimestamp),
    "1h": calculateSectorRanks(snapshots, offsetTimestamp(currentTimestamp, 1)),
    "6h": calculateSectorRanks(snapshots, offsetTimestamp(currentTimestamp, 6)),
    "24h": calculateSectorRanks(snapshots, offsetTimestamp(currentTimestamp, 24)),
  };
}

function findSectorHistory(snapshots, sectorName) {
  const normalized = normalize(sectorName);
  return snapshots
    .filter(
      (snapshot) =>
        normalize(snapshot.sector_id) === normalized || normalize(snapshot.sector_name) === normalized,
    )
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function findLookbackSnapshot(snapshots, currentTimestamp, label) {
  return snapshotsAtHour(snapshots, offsetTimestamp(currentTimestamp, Number(label.replace("h", ""))))
    .find((snapshot) => snapshot.sector_id === snapshots.at(-1)?.sector_id) ?? null;
}

function snapshotsAtHour(snapshots, timestamp) {
  const targetHour = hourKey(timestamp);
  return snapshots.filter((snapshot) => hourKey(snapshot.timestamp) === targetHour);
}

function buildRankMap(snapshots) {
  return new Map(
    [...snapshots]
      .sort((a, b) => b.average_return - a.average_return)
      .map((snapshot, index) => [snapshot.sector_id, index + 1]),
  );
}

function offsetTimestamp(timestamp, hours) {
  const date = new Date(timestamp);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}

function hourKey(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function classifyParticipation(current, previous) {
  const delta = current.breadth.positive - previous.breadth.positive;
  if (delta > 0) {
    return "Improving";
  }
  if (delta < 0) {
    return "Weakening";
  }
  return "Stable";
}

function renderBreadthLine(comparison, current) {
  if (!comparison.previous) {
    return `${comparison.label}: Not enough history yet.`;
  }
  return `${comparison.label}: ${formatBreadth(comparison.previous)} -> ${formatBreadth(current)}`;
}

function renderRankLine(comparison, currentRank) {
  if (!comparison.rank || !currentRank) {
    return `${comparison.label}: Not enough history yet.`;
  }
  return `${comparison.label}: #${comparison.rank} -> #${currentRank}`;
}

function countStableLeaders(current, previous) {
  const previousLeaders = new Set(previous.leaders.slice(0, 3));
  return current.leaders.slice(0, 3).filter((leader) => previousLeaders.has(leader)).length;
}

function formatBreadth(snapshot) {
  return `${snapshot.breadth.positive}/${snapshot.breadth.available}`;
}

function formatDelta(value) {
  if (!Number.isFinite(value)) {
    return "Not enough history yet.";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) {
    return NaN;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
