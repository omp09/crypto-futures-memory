import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarketBriefFromStates, fetchMarketStates } from "./market.js";
import { buildRelativeMetricsBlock } from "./relative-metrics.js";
import {
  buildSectorSnapshots,
  getRegistrySymbols,
  loadSectorRegistry,
  renderSectorBrief,
} from "./sector-intelligence.js";
import {
  renderSectorHistoryDebug,
  SectorHistoryStore,
  toSectorHistorySnapshot,
} from "./sector-history-store.js";
import { buildSectorRelativeMetrics } from "./sector-relative-metrics.js";
import {
  renderComparisonFacts,
  renderHistoryDebug,
  SnapshotHistoryStore,
  toHistorySnapshot,
} from "./history-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const historyStore =
    options.historyStore ??
    new SnapshotHistoryStore({
      filePath: path.resolve(__dirname, "../data/snapshot-history.json"),
    });
  const sectorHistoryStore =
    options.sectorHistoryStore ??
    new SectorHistoryStore({
      filePath: path.resolve(__dirname, "../data/sector-history.json"),
    });
  const sectorRegistryPath =
    options.sectorRegistryPath ?? path.resolve(__dirname, "../data/sector-registry.json");
  const sectorRegistry = options.sectorRegistry ?? null;
  const fetchStates = options.fetchMarketStates ?? fetchMarketStates;

  async function handleText(text) {
    const cleanText = String(text ?? "").trim();

    if (cleanText === "/start" || cleanText === "/help") {
      return renderHelp();
    }

    if (isHistoryRequest(cleanText)) {
      const symbol = parseHistorySymbol(cleanText);
      return buildHistoryResponse(symbol);
    }

    if (isSectorHistoryRequest(cleanText)) {
      const sectorName = parseSectorHistoryName(cleanText);
      return buildSectorHistoryResponse(sectorName);
    }

    if (isSectorMetricsRequest(cleanText)) {
      const sectorName = parseSectorMetricsName(cleanText);
      return buildSectorMetricsResponse(sectorName);
    }

    if (isSectorsRequest(cleanText)) {
      return buildSectorsResponse();
    }

    if (isMarketRequest(cleanText)) {
      const symbols = parseSymbols(cleanText);
      const states = await fetchStates(symbols);
      await recordStates(states);
      return [
        buildMarketBriefFromStates(states),
        "",
        await buildRelativeMetricsBlock({ states, historyStore }),
        "",
        await buildComparisonSummary(states),
      ].join("\n");
    }

    return "שלח /market או כתוב \"מצב שוק\" כדי לקבל תמונת מצב של חוזים עתידיים.";
  }

  async function recordHourlySnapshots() {
    const states = await fetchStates([]);
    await recordStates(states);
  }

  async function recordHourlySectorSnapshots() {
    await fetchAndRecordSectorSnapshots();
  }

  async function recordStates(states) {
    const timestamp = new Date();
    const snapshots = states
      .filter((state) => state.symbol === "BTCUSDT" || state.symbol === "ETHUSDT")
      .map((state) => toHistorySnapshot(state, timestamp));
    await historyStore.recordSnapshots(snapshots);
  }

  async function buildHistoryResponse(symbol) {
    const debug = await historyStore.describeHistory(symbol);
    const comparison = await historyStore.compare(symbol);
    return [renderHistoryDebug(debug), "", "השוואות:", renderComparisonFacts(comparison)].join("\n");
  }

  async function buildComparisonSummary(states) {
    const comparisons = await Promise.all(
      states
        .filter((state) => state.symbol === "BTCUSDT" || state.symbol === "ETHUSDT")
        .map((state) => historyStore.compare(state.symbol)),
    );

    return [
      "זיכרון שוק:",
      ...comparisons.map((comparison) => `${comparison.symbol}:\n${renderComparisonFacts(comparison)}`),
    ].join("\n");
  }

  async function buildSectorsResponse() {
    const snapshots = await fetchAndRecordSectorSnapshots();
    return renderSectorBrief(snapshots);
  }

  async function fetchAndRecordSectorSnapshots() {
    const registry = sectorRegistry ?? (await loadSectorRegistry(sectorRegistryPath));
    const symbols = getRegistrySymbols(registry);
    const states = await fetchStates(symbols);
    const snapshots = buildSectorSnapshots({ registry, states });
    await recordSectorSnapshots(snapshots);
    return snapshots;
  }

  async function recordSectorSnapshots(snapshots) {
    const timestamp = new Date();
    await sectorHistoryStore.recordSnapshots(
      snapshots.map((snapshot) => toSectorHistorySnapshot(snapshot, timestamp)),
    );
  }

  async function buildSectorHistoryResponse(sectorName) {
    const debug = await sectorHistoryStore.describeHistory(sectorName);
    const comparison = await sectorHistoryStore.compare(sectorName);
    return renderSectorHistoryDebug(debug, comparison);
  }

  async function buildSectorMetricsResponse(sectorName) {
    const registry = sectorRegistry ?? (await loadSectorRegistry(sectorRegistryPath));
    const symbols = [...new Set([...getRegistrySymbols(registry), "BTCUSDT"])];
    const states = await fetchStates(symbols);
    const snapshots = buildSectorSnapshots({ registry, states });
    await recordSectorSnapshots(snapshots);
    const sectorHistory = await sectorHistoryStore.load();
    const btcState = states.find((state) => state.symbol === "BTCUSDT") ?? null;
    return buildSectorRelativeMetrics({ sectorName, sectorHistory, btcState });
  }

  return {
    handleText,
    recordHourlySnapshots,
    recordHourlySectorSnapshots,
  };
}

export function renderHelp() {
  return [
    "Crypto Futures Desk",
    "",
    "פקודות:",
    "/market - סקירת מצב שוק קצרה",
    "/sectors - סקירת Sector Intelligence",
    "/sector-history AI - בדיקת Sector Memory",
    "/sector-metrics AI - בדיקת Sector Relative Metrics",
    "/history BTCUSDT - בדיקת snapshot history",
    "",
    "אפשר גם לכתוב: מצב שוק / מה מצב החוזים?",
    "",
    "הבוט מסכם מצב שוק, מינוף, השתתפות אלטים ושורה תחתונה. אין המלצות קנייה/מכירה.",
  ].join("\n");
}

function isHistoryRequest(text) {
  return text.toLowerCase().startsWith("/history");
}

function isSectorHistoryRequest(text) {
  return text.toLowerCase().startsWith("/sector-history");
}

function isSectorMetricsRequest(text) {
  return text.toLowerCase().startsWith("/sector-metrics");
}

function isSectorsRequest(text) {
  return text.toLowerCase().startsWith("/sectors");
}

function parseHistorySymbol(text) {
  const match = text.toUpperCase().match(/\b[A-Z]{2,12}USDT\b/);
  return match ? match[0] : "BTCUSDT";
}

function parseSectorHistoryName(text) {
  return text.replace(/^\/sector-history/i, "").trim() || "AI";
}

function parseSectorMetricsName(text) {
  return text.replace(/^\/sector-metrics/i, "").trim() || "AI";
}

function isMarketRequest(text) {
  const normalized = text.toLowerCase();
  return (
    normalized.startsWith("/market") ||
    normalized.includes("מצב שוק") ||
    normalized.includes("חוזים") ||
    normalized.includes("futures") ||
    normalized.includes("market")
  );
}

function parseSymbols(text) {
  const matches = text.toUpperCase().match(/\b[A-Z]{2,12}USDT\b/g);
  if (matches?.length) {
    return [...new Set(matches)].slice(0, 5);
  }

  return [];
}
