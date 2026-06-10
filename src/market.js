const BINANCE_FUTURES_BASE_URL = "https://fapi.binance.com";
const MAJOR_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const ALT_SYMBOLS = [
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TONUSDT",
  "SUIUSDT",
  "WIFUSDT",
  "PEPEUSDT",
  "NEARUSDT",
  "APTUSDT",
  "OPUSDT",
  "ARBUSDT",
];

export async function buildMarketSnapshot(symbols = []) {
  const states = await fetchMarketStates(symbols);
  return buildMarketBriefFromStates(states);
}

export async function fetchMarketStates(symbols = []) {
  const requestedSymbols = normalizeSymbols(symbols);
  const settledStates = await Promise.allSettled(requestedSymbols.map(fetchSymbolState));
  return settledStates
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

export function buildMarketBriefFromStates(states) {
  const bySymbol = new Map(states.map((state) => [state.symbol, state]));
  const btc = bySymbol.get("BTCUSDT");
  const eth = bySymbol.get("ETHUSDT");
  const alts = states.filter((state) => !MAJOR_SYMBOLS.includes(state.symbol));
  const standoutAlts = selectStandoutAlts(alts);
  const leverageRead = buildLeverageRead(states);
  const derivativesRead = buildDerivativesRead(states);
  const marketMode = classifyMarketMode({ btc, eth, alts, leverageRead });
  const bottomLine = classifyBottomLine({ btc, eth, alts, marketMode, leverageRead });

  return [
    "מצב שוק כרגע:",
    "",
    `BTC: ${describeMajor(btc, "BTC")}`,
    `ETH: ${describeEth(eth, btc)}`,
    `אלטים: ${describeAltParticipation(alts, btc)}`,
    `דולר/USDT: אין מקור dominance מחובר ב-V2, לכן לא משוקלל בקריאה.`,
    "",
    "קריאת נגזרים:",
    ...derivativesRead,
    "",
    `מצב כללי: ${marketMode}.`,
    "",
    "בולטים כרגע:",
    ...standoutAlts.map((state, index) => `${index + 1}. ${formatBaseAsset(state.symbol)} - ${describeStandout(state)}`),
    "",
    "קריאה:",
    buildInterpretation({ btc, eth, alts, marketMode, leverageRead }),
    "",
    `שורה תחתונה: ${bottomLine}.`,
    "זו סקירת מצב בלבד, לא המלצת קנייה/מכירה.",
  ].join("\n");
}

async function fetchSymbolState(symbol) {
  const [ticker, premium, openInterest, candles] = await Promise.all([
    fetchJson("/fapi/v1/ticker/24hr", { symbol }),
    fetchJson("/fapi/v1/premiumIndex", { symbol }),
    fetchJson("/fapi/v1/openInterest", { symbol }),
    fetchJson("/fapi/v1/klines", { symbol, interval: "1h", limit: "6" }),
  ]);

  const recentCandles = candles.map((candle) => ({
    open: number(candle[1]),
    close: number(candle[4]),
    volume: number(candle[5]),
    quoteVolume: number(candle[7]),
  }));
  const latestCandle = recentCandles.at(-1);
  const previousCandles = recentCandles.slice(0, -1);

  return {
    symbol,
    lastPrice: number(ticker.lastPrice),
    priceChangePercent: number(ticker.priceChangePercent),
    volume: number(ticker.volume),
    quoteVolume: number(ticker.quoteVolume),
    markPrice: number(premium.markPrice),
    indexPrice: number(premium.indexPrice),
    lastFundingRate: number(premium.lastFundingRate),
    openInterest: number(openInterest.openInterest),
    oneHourChangePercent: latestCandle
      ? ((latestCandle.close - latestCandle.open) / latestCandle.open) * 100
      : 0,
    latestQuoteVolume: latestCandle?.quoteVolume ?? 0,
    averageQuoteVolume:
      average(previousCandles.map((candle) => candle.quoteVolume)) || latestCandle?.quoteVolume || 0,
  };
}

function normalizeSymbols(symbols) {
  if (symbols.length) {
    return [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  }

  return [...new Set([...MAJOR_SYMBOLS, ...ALT_SYMBOLS])];
}

function describeMajor(state, label) {
  if (!state) {
    return `${label} לא זמין כרגע.`;
  }

  const direction = describeDirection(state.priceChangePercent);
  const intraday = Math.abs(state.oneHourChangePercent) >= 0.8 ? `, שעה אחרונה ${formatSignedPercent(state.oneHourChangePercent)}` : "";
  return `${direction} ב-24ש (${formatSignedPercent(state.priceChangePercent)}${intraday}), funding ${describeFunding(state.lastFundingRate)}, נפח ${describeVolumeState(state)}.`;
}

function describeEth(eth, btc) {
  if (!eth) {
    return "ETH לא זמין כרגע.";
  }

  if (!btc) {
    return describeMajor(eth, "ETH");
  }

  const relative = eth.priceChangePercent - btc.priceChangePercent;
  const relativeText =
    relative > 0.8 ? "חזק יחסית ל-BTC" : relative < -0.8 ? "חלש יחסית ל-BTC" : "נע דומה ל-BTC";
  return `${relativeText}; ${describeDirection(eth.priceChangePercent)} (${formatSignedPercent(eth.priceChangePercent)}), funding ${describeFunding(eth.lastFundingRate)}.`;
}

function describeAltParticipation(alts, btc) {
  if (!alts.length) {
    return "אין מספיק נתוני אלטים.";
  }

  const positiveRatio = alts.filter((alt) => alt.priceChangePercent > 0).length / alts.length;
  const outperformRatio = btc
    ? alts.filter((alt) => alt.priceChangePercent > btc.priceChangePercent).length / alts.length
    : 0;
  const strongMovers = alts.filter((alt) => alt.priceChangePercent > 3).length;

  if (positiveRatio >= 0.65 && outperformRatio >= 0.45) {
    return `משתתפים בצורה רחבה; ${strongMovers} אלטים עם תנועה חזקה.`;
  }
  if (positiveRatio >= 0.45) {
    return "השתתפות חלקית; יש תנועה נקודתית אבל לא breadth מלא.";
  }
  return "חלשים יחסית; אין השתתפות רחבה.";
}

function buildLeverageRead(states) {
  const avgFundingBps = average(states.map((state) => state.lastFundingRate * 10000));
  const positiveFundingRatio = states.filter((state) => state.lastFundingRate > 0.0001).length / states.length;
  const highFundingCount = states.filter((state) => state.lastFundingRate * 10000 > 3).length;
  const volumeAnomalyCount = states.filter((state) => volumeRatio(state) >= 1.7).length;

  if (highFundingCount >= 4 || avgFundingBps > 2.5) {
    return {
      pressure: "hot",
      text: `מתוח; funding ממוצע חיובי (${formatBps(avgFundingBps)}) ו-${highFundingCount} מטבעות עם funding גבוה.`,
    };
  }

  if (positiveFundingRatio > 0.65 && volumeAnomalyCount >= 3) {
    return {
      pressure: "building",
      text: `נבנה; funding חיובי ברוב השוק יחד עם ${volumeAnomalyCount} חריגות נפח.`,
    };
  }

  if (Math.abs(avgFundingBps) <= 1.2) {
    return {
      pressure: "neutral",
      text: `ניטרלי יחסית; funding ממוצע ${formatBps(avgFundingBps)}, בלי סימן ברור לצפיפות קיצונית.`,
    };
  }

  return {
    pressure: "mixed",
    text: `מעורב; funding ממוצע ${formatBps(avgFundingBps)}, צריך אישור דרך נפח והשתתפות אלטים.`,
  };
}

function buildDerivativesRead(states) {
  return [
    `Funding: ${analyzeFunding(states)}`,
    `OI: ${analyzeOpenInterest(states)}`,
    `Volume: ${analyzeVolume(states)}`,
    `Basis: ${analyzeBasis(states)}`,
  ];
}

function analyzeFunding(states) {
  const avgFundingBps = average(states.map((state) => state.lastFundingRate * 10000));
  const highPositiveCount = states.filter((state) => state.lastFundingRate * 10000 > 3).length;
  const negativeCount = states.filter((state) => state.lastFundingRate * 10000 < -1).length;

  if (highPositiveCount >= 4 || avgFundingBps > 2.5) {
    return "חריג וחיובי מדי. זה אומר שהרבה שחקנים מוכנים לשלם כדי להחזיק פוזיציות long, ולכן המצב שורי בטווח הקצר אבל מסוכן לרדיפה אם המחיר כבר רץ.";
  }
  if (negativeCount >= 4 || avgFundingBps < -1.5) {
    return "שלילי יחסית למצב רגיל. זה מצביע על לחץ short או פסימיות בנגזרים; דובי כל עוד המחיר חלש, אבל יכול להפוך לשורי אם המחיר מפסיק לרדת.";
  }
  if (Math.abs(avgFundingBps) <= 1.2) {
    return "ניטרלי וקרוב למצב רגיל. אין כרגע סימן ברור לצפיפות long/short, ולכן Funding לבד לא נותן יתרון.";
  }
  return "מעורב. יש הטיה קלה, אבל לא מספיק חריגה כדי להסיק כיוון בלי אישור ממחיר ונפח.";
}

function analyzeOpenInterest(states) {
  const activeMoveCount = states.filter((state) => Math.abs(state.priceChangePercent) > 2).length;
  const strongVolumeCount = states.filter((state) => volumeRatio(state) >= 1.7).length;

  if (activeMoveCount >= 5 && strongVolumeCount >= 3) {
    return "יש עניין פעיל סביב התנועה, אבל אין לנו עדיין שינוי OI היסטורי ב-V2. לכן הקריאה היא שהשוק פעיל, לא בהכרח עמוס. כדי לקבוע אם OI עולה/יורד צריך להוסיף endpoint היסטורי.";
  }
  return "אין מספיק נתונים לקבוע שינוי אמיתי. Binance מחזיר snapshot של OI, אבל בלי השוואה לשעות קודמות אי אפשר לדעת אם פוזיציות נבנות או נסגרות. ניטרלי עד שנוסיף OI history.";
}

function analyzeVolume(states) {
  const anomalyCount = states.filter((state) => volumeRatio(state) >= 1.7).length;
  const softCount = states.filter((state) => volumeRatio(state) <= 0.75).length;

  if (anomalyCount >= 4) {
    return "חריג מעל הרגיל בכמה מטבעות. זה אומר שיש השתתפות אמיתית ולא רק תנועה דקה; שורי אם המחיר מחזיק, דובי אם הנפח מגיע בירידות.";
  }
  if (softCount > states.length * 0.55) {
    return "נמוך יחסית לשעות האחרונות. זה אומר שהתנועה פחות משכנעת, ולכן עדיף לא להסיק המשך חזק ממחיר בלבד.";
  }
  return "בינוני וקרוב לרגיל. יש פעילות, אבל לא מספיק חריגה כדי להגיד שהשוק קיבל זרימה חזקה.";
}

function analyzeBasis(states) {
  const basisValues = states
    .map((state) => ((state.markPrice - state.indexPrice) / state.indexPrice) * 100)
    .filter((value) => Number.isFinite(value));
  const avgBasis = average(basisValues);
  const positiveStressCount = basisValues.filter((value) => value > 0.08).length;
  const negativeStressCount = basisValues.filter((value) => value < -0.05).length;

  if (positiveStressCount >= 4 || avgBasis > 0.06) {
    return "פרמיה חיובית חריגה. נגזרים מתומחרים מעל השוק הספוט, וזה שורי אבל גם מצביע על צפיפות וסיכון ל-reset אם הקונים נחלשים.";
  }
  if (negativeStressCount >= 4 || avgBasis < -0.04) {
    return "דיסקאונט חריג. נגזרים מתומחרים מתחת לספוט, וזה דובי או פחדני; אם המחיר מתייצב, זה יכול ליצור תנאי squeeze.";
  }
  return "קרוב לנורמלי. אין ניתוק משמעותי בין נגזרים לספוט, לכן Basis כרגע ניטרלי ולא מסמן לחץ חריג.";
}

function describeVolume(states) {
  const anomalyCount = states.filter((state) => volumeRatio(state) >= 1.7).length;
  const softCount = states.filter((state) => volumeRatio(state) <= 0.75).length;

  if (anomalyCount >= 4) {
    return `גבוה/חריג בכמה מטבעות (${anomalyCount}); יש עניין פעיל בשוק.`;
  }
  if (softCount > states.length * 0.55) {
    return "בינוני-נמוך; אין כניסה רחבה חזקה כרגע.";
  }
  return "בינוני; יש פעילות, אבל לא פאניקה או כניסה רוחבית חריגה.";
}

function classifyMarketMode({ btc, eth, alts, leverageRead }) {
  const altParticipation = alts.filter((alt) => alt.priceChangePercent > 0).length / Math.max(alts.length, 1);
  const btcStrong = btc?.priceChangePercent > 1.5;
  const ethStrong = eth?.priceChangePercent > 1.5;
  const btcWeak = btc?.priceChangePercent < -1.5;
  const ethWeak = eth?.priceChangePercent < -1.5;

  if (leverageRead.pressure === "hot" && (btcStrong || ethStrong)) {
    return "מסוכן לרדיפה";
  }
  if ((btcWeak && ethWeak) || altParticipation < 0.3) {
    return "מתוח";
  }
  if (leverageRead.pressure === "building" && altParticipation >= 0.45) {
    return "מוכן לתנועה";
  }
  if (Math.abs(btc?.priceChangePercent ?? 0) < 1 && Math.abs(eth?.priceChangePercent ?? 0) < 1) {
    return "רגוע";
  }
  return "מעורב";
}

function classifyBottomLine({ btc, eth, alts, marketMode, leverageRead }) {
  const altParticipation = alts.filter((alt) => alt.priceChangePercent > 0).length / Math.max(alts.length, 1);
  const majorsPositive = (btc?.priceChangePercent ?? 0) > 0 && (eth?.priceChangePercent ?? 0) > 0;

  if (marketMode === "מסוכן לרדיפה") {
    return "Mixed / Wait. יש תנועה, אבל התנאים לא נקיים לרדיפה";
  }
  if (majorsPositive && altParticipation >= 0.6 && leverageRead.pressure !== "hot") {
    return "Risk-on זהיר. השתתפות קיימת, כל עוד המינוף לא מתחמם";
  }
  if (!majorsPositive && altParticipation < 0.4) {
    return "Risk-off / Wait. אין השתתפות רחבה";
  }
  return "Mixed / Wait. אין יתרון ברור";
}

function buildInterpretation({ btc, eth, alts, marketMode, leverageRead }) {
  const ethRelative = eth && btc ? eth.priceChangePercent - btc.priceChangePercent : 0;
  const altParticipation = alts.filter((alt) => alt.priceChangePercent > 0).length / Math.max(alts.length, 1);

  if (marketMode === "מסוכן לרדיפה") {
    return "יש מומנטום, אבל המינוף/התמחור מתחילים להיראות צפופים. זה מצב שבו עדיף להבין את ההקשר ולא לרדוף אחרי נר ירוק.";
  }
  if (marketMode === "מוכן לתנועה") {
    return "השוק מראה סימני הכנה לתנועה: השתתפות חלקית-רחבה, פעילות נפח, ומינוף שעדיין לא קיצוני.";
  }
  if (altParticipation < 0.35) {
    return "השוק לא רחב. גם אם BTC מחזיק, אלטים לא נותנים אישור חזק כרגע.";
  }
  if (ethRelative < -0.8) {
    return "ETH חלש יחסית ל-BTC, וזה מוריד איכות ל-risk-on רחב.";
  }
  if (leverageRead.pressure === "neutral") {
    return "המינוף נראה מאוזן יחסית. אם תגיע תנועה, האישור החשוב יהיה השתתפות אלטים ונפח.";
  }
  return "התמונה מעורבת: יש תנועה בחלק מהשוק, אבל אין אישור נקי מכל המרכיבים יחד.";
}

function selectStandoutAlts(alts) {
  return [...alts]
    .map((state) => ({
      ...state,
      standoutScore:
        Math.abs(state.priceChangePercent) * 1.4 +
        Math.abs(state.oneHourChangePercent) * 1.2 +
        Math.min(volumeRatio(state), 3) * 1.6 +
        Math.abs(state.lastFundingRate * 10000) * 0.4,
    }))
    .sort((a, b) => b.standoutScore - a.standoutScore)
    .slice(0, 3);
}

function describeStandout(state) {
  const pieces = [`${formatSignedPercent(state.priceChangePercent)} ב-24ש`];
  if (Math.abs(state.oneHourChangePercent) >= 0.8) {
    pieces.push(`${formatSignedPercent(state.oneHourChangePercent)} בשעה`);
  }
  if (volumeRatio(state) >= 1.7) {
    pieces.push("נפח חריג");
  }
  if (Math.abs(state.lastFundingRate * 10000) >= 2) {
    pieces.push(`funding ${describeFunding(state.lastFundingRate)}`);
  }
  return pieces.join(", ");
}

async function fetchJson(path, params) {
  const url = new URL(`${BINANCE_FUTURES_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.msg ?? `Binance request failed: ${path}`);
  }
  return payload;
}

function describeDirection(value) {
  if (value > 1.5) {
    return "חזק";
  }
  if (value > 0.3) {
    return "חיובי קל";
  }
  if (value < -1.5) {
    return "חלש";
  }
  if (value < -0.3) {
    return "שלילי קל";
  }
  return "יציב";
}

function describeFunding(rate) {
  const bps = rate * 10000;
  if (bps > 3) {
    return "גבוה וחיובי";
  }
  if (bps > 1) {
    return "חיובי מתון";
  }
  if (bps < -1) {
    return "שלילי";
  }
  return "ניטרלי";
}

function describeVolumeState(state) {
  const ratio = volumeRatio(state);
  if (ratio >= 1.7) {
    return "חריג";
  }
  if (ratio <= 0.75) {
    return "נמוך";
  }
  return "בינוני";
}

function volumeRatio(state) {
  if (!state.averageQuoteVolume) {
    return 1;
  }
  return state.latestQuoteVolume / state.averageQuoteVolume;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) {
    return 0;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBaseAsset(symbol) {
  return symbol.replace("USDT", "");
}

function formatSignedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatBps(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}bps`;
}
