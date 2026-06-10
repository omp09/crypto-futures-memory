import { readFile } from "node:fs/promises";

export async function loadSectorRegistry(filePath) {
  const raw = await readFile(filePath, "utf8");
  const registry = JSON.parse(raw);
  return {
    version: registry.version ?? 1,
    sectors: Array.isArray(registry.sectors)
      ? registry.sectors.filter((sector) => sector.status === "active")
      : [],
  };
}

export function getRegistrySymbols(registry) {
  return [
    ...new Set(
      registry.sectors.flatMap((sector) =>
        sector.members.map((member) => member.symbol.toUpperCase()),
      ),
    ),
  ];
}

export function buildSectorSnapshots({ registry, states }) {
  const statesBySymbol = new Map(states.map((state) => [state.symbol, state]));

  return registry.sectors
    .map((sector) => buildSectorSnapshot(sector, statesBySymbol))
    .filter((snapshot) => snapshot.availableAssets > 0)
    .sort(sortSectorSnapshots);
}

export function renderSectorBrief(snapshots) {
  if (!snapshots.length) {
    return "Sector Intelligence\nNo sector data available yet.";
  }

  return [
    "Sector Intelligence",
    "",
    ...snapshots.flatMap((snapshot) => renderSectorSnapshot(snapshot)),
  ].join("\n");
}

function buildSectorSnapshot(sector, statesBySymbol) {
  const assets = sector.members
    .map((member) => {
      const state = statesBySymbol.get(member.symbol.toUpperCase());
      if (!state) {
        return null;
      }
      return {
        symbol: member.symbol.toUpperCase(),
        asset: formatAsset(member.symbol),
        confidence: member.confidence ?? 1,
        weight: member.weight ?? 1,
        return24h: state.priceChangePercent,
        volumeRatio: volumeRatio(state),
        quoteVolume: state.quoteVolume,
      };
    })
    .filter(Boolean);
  const returns = assets.map((asset) => asset.return24h);
  const positiveCount = assets.filter((asset) => asset.return24h > 0).length;
  const totalMembers = sector.members.length;
  const availableAssets = assets.length;
  const averageReturn = average(returns);
  const medianReturn = median(returns);
  const leaders = [...assets].sort((a, b) => b.return24h - a.return24h).slice(0, 3);
  const leaderConcentration = calculateLeaderConcentration(assets);
  const volumeParticipation = assets.filter((asset) => asset.volumeRatio >= 1.2).length;
  const breadthRatio = availableAssets ? positiveCount / availableAssets : 0;
  const label = classifySector({
    averageReturn,
    medianReturn,
    breadthRatio,
    leaderConcentration,
    availableAssets,
  });

  return {
    id: sector.id,
    name: sector.name,
    totalMembers,
    availableAssets,
    positiveCount,
    breadthRatio,
    averageReturn,
    medianReturn,
    leaders,
    leaderConcentration,
    volumeParticipation,
    label,
  };
}

function classifySector({
  averageReturn,
  medianReturn,
  breadthRatio,
  leaderConcentration,
  availableAssets,
}) {
  if (!availableAssets) {
    return "Mixed";
  }
  if (
    (averageReturn > 0 && breadthRatio < 0.45) ||
    (leaderConcentration >= 0.8 && breadthRatio < 0.65)
  ) {
    return "Narrow Participation";
  }
  if (breadthRatio >= 0.65 && medianReturn > 1) {
    return "Strong";
  }
  if (breadthRatio >= 0.5 && averageReturn > 0) {
    return "Improving";
  }
  if (breadthRatio <= 0.35 && medianReturn < 0) {
    return "Weak";
  }
  return "Mixed";
}

function renderSectorSnapshot(snapshot) {
  const lines = [
    snapshot.name,
    snapshot.label,
    `Breadth: ${snapshot.positiveCount}/${snapshot.availableAssets} positive`,
    `Leaders: ${snapshot.leaders.map((leader) => leader.asset).join(", ") || "n/a"}`,
  ];

  if (snapshot.label === "Narrow Participation") {
    lines.push("Movement concentrated in a few assets");
  }

  return [...lines, ""];
}

function sortSectorSnapshots(a, b) {
  const scoreA = labelScore(a.label) + a.breadthRatio * 2 + a.medianReturn / 10;
  const scoreB = labelScore(b.label) + b.breadthRatio * 2 + b.medianReturn / 10;
  return scoreB - scoreA;
}

function labelScore(label) {
  switch (label) {
    case "Strong":
      return 5;
    case "Improving":
      return 4;
    case "Narrow Participation":
      return 3;
    case "Mixed":
      return 2;
    case "Weak":
      return 1;
    default:
      return 0;
  }
}

function calculateLeaderConcentration(assets) {
  const positiveAssets = assets.filter((asset) => asset.return24h > 0);
  if (!positiveAssets.length) {
    return 0;
  }
  const topTwoPositiveReturn = [...positiveAssets]
    .sort((a, b) => b.return24h - a.return24h)
    .slice(0, 2)
    .reduce((sum, asset) => sum + Math.max(asset.return24h, 0), 0);
  const totalPositiveReturn = positiveAssets.reduce(
    (sum, asset) => sum + Math.max(asset.return24h, 0),
    0,
  );
  return totalPositiveReturn ? topTwoPositiveReturn / totalPositiveReturn : 0;
}

function volumeRatio(state) {
  if (!state.averageQuoteVolume) {
    return 1;
  }
  return state.latestQuoteVolume / state.averageQuoteVolume;
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return sorted[midpoint];
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function formatAsset(symbol) {
  return symbol.toUpperCase().replace("USDT", "");
}
