const EPSILON = 0.1;

export async function buildRelativeMetricsBlock({ states, historyStore }) {
  const bySymbol = new Map(states.map((state) => [state.symbol, state]));
  const btcState = bySymbol.get("BTCUSDT");
  const ethState = bySymbol.get("ETHUSDT");
  const btcHistory = await historyStore.compare("BTCUSDT");
  const ethHistory = await historyStore.compare("ETHUSDT");

  const metrics = [
    calculateLeverageExpansionRatio("BTCUSDT", btcHistory, "6h"),
    calculateVolumeExpansion("BTCUSDT", btcHistory),
    calculateEthRelativeStrength(btcState, ethState),
    calculateFundingMomentum("BTCUSDT", btcHistory, "6h"),
    calculateBasisDrift("BTCUSDT", btcHistory, "1h"),
  ];

  return ["Relative Metrics", "", ...metrics.flatMap(renderMetric)].join("\n");
}

function calculateLeverageExpansionRatio(symbol, history, lookbackLabel) {
  const comparison = findComparison(history, lookbackLabel);
  if (!comparison?.previous || !history.current) {
    return notEnough("Leverage Expansion Ratio", "OI change / price change over 6h.");
  }

  const oiChange = percentChangeNumber(history.current.open_interest, comparison.previous.open_interest);
  const priceChange = percentChangeNumber(history.current.price, comparison.previous.price);
  if (!Number.isFinite(oiChange) || !Number.isFinite(priceChange)) {
    return notEnough("Leverage Expansion Ratio", "OI change / price change over 6h.");
  }

  const ratio = Math.abs(oiChange) / Math.max(Math.abs(priceChange), EPSILON);
  return {
    name: "Leverage Expansion Ratio",
    value: `${ratio.toFixed(1)}x`,
    note: `${symbol}: OI change relative to price change over 6h.`,
  };
}

function calculateVolumeExpansion(symbol, history) {
  const comparison = findComparison(history, "24h");
  if (!comparison?.previous || !history.current) {
    return notEnough("Volume Expansion", "Current volume / 24h reference volume.");
  }

  if (!history.current.volume || !comparison.previous.volume) {
    return notEnough("Volume Expansion", "Current volume / 24h reference volume.");
  }

  const ratio = history.current.volume / comparison.previous.volume;
  return {
    name: "Volume Expansion",
    value: `${ratio.toFixed(1)}x`,
    note: `${symbol}: current quote volume vs 24h reference snapshot.`,
  };
}

function calculateEthRelativeStrength(btcState, ethState) {
  if (!btcState || !ethState) {
    return notEnough("ETH Relative Strength", "ETH 24h return - BTC 24h return.");
  }

  const spread = ethState.priceChangePercent - btcState.priceChangePercent;
  return {
    name: "ETH Relative Strength",
    value: formatSignedPercent(spread),
    note: "ETH 24h performance relative to BTC.",
  };
}

function calculateFundingMomentum(symbol, history, lookbackLabel) {
  const comparison = findComparison(history, lookbackLabel);
  if (!comparison?.previous || !history.current) {
    return notEnough("Funding Momentum", "Funding change over 6h.");
  }

  const current = history.current.funding;
  const previous = comparison.previous.funding;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return notEnough("Funding Momentum", "Funding change over 6h.");
  }

  return {
    name: "Funding Momentum",
    value: formatSignedBps((current - previous) * 10000),
    note: `${symbol}: funding delta vs 6h ago.`,
  };
}

function calculateBasisDrift(symbol, history, lookbackLabel) {
  const comparison = findComparison(history, lookbackLabel);
  if (!comparison?.previous || !history.current) {
    return notEnough("Basis Drift",
      "Basis change over 1h.");
  }

  const current = history.current.basis;
  const previous = comparison.previous.basis;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return notEnough("Basis Drift", "Basis change over 1h.");
  }

  return {
    name: "Basis Drift",
    value: formatSignedBps((current - previous) * 10000),
    note: `${symbol}: mark/index basis delta vs 1h ago.`,
  };
}

function renderMetric(metric) {
  return [`${metric.name}:`, metric.value, metric.note, ""];
}

function findComparison(history, label) {
  return history?.comparisons?.find((comparison) => comparison.label === label);
}

function notEnough(name, note) {
  return {
    name,
    value: "Not enough history yet.",
    note,
  };
}

function percentChangeNumber(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return NaN;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatSignedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatSignedBps(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}bps`;
}
