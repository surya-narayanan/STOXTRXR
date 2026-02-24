import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;
const AV_BASE = process.env.ALPHAVANTAGE_BASE || "https://www.alphavantage.co";
const TARGET_DATE = "2025-11-01";
const OUTPUT_FILE = path.join(__dirname, "..", "historical_prices_2025-11-01.md");

const TICKERS = [
  "LITX", "SMCI", "AAOI", "LITE", "NBIS", "SNXX", "TTMI", "AEHR", "AMKR", "SNDK",
  "SMSMTY", "EWY", "UCTT", "CIEN", "ALAB", "KLIC", "ORCL", "COHR", "AVGO", "APH",
  "CSCO", "GOOGL", "GOOG", "SERV", "ONTO", "AMD", "NET", "IREN", "SFTBY", "FN",
  "SKYT", "CRDO", "MBLY", "VRT", "AMZN", "ACMR", "TER", "DT", "CRWV", "TOELY",
  "KEYS", "ENTG", "AAPL", "AMAT", "TSM", "VNET", "NVDA", "COHU", "SNPS", "VECO",
  "TEL", "MTSI", "UMC", "KLAC", "ASML", "GFS", "DOCN", "ASX", "MU", "ACLS",
  "INTC", "ARM", "ASYS", "APLD", "ICHR", "ANET", "CC", "NVMI", "LRCX", "SMTC",
  "TSEM", "FORM", "SYNA", "CAMT", "SITM", "WDC", "ON", "STX", "WDCX", "BTDR"
];

const MIN_INTERVAL_MS = 1100;
let nextAvailable = 0;
let rateLimited = false;

function avUrl(params) {
  const url = new URL(`${AV_BASE}/query`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", AV_KEY);
  return url.toString();
}

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextAvailable - now);
  nextAvailable = Math.max(nextAvailable, now) + MIN_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function throwIfAlphaVantageError(data) {
  const note = data?.Note || data?.Information;
  const err = data?.["Error Message"];
  if (note) throw new Error(note);
  if (err) throw new Error(err);
}

async function fetchSeries(ticker) {
  await throttle();
  const url = avUrl({
    function: "TIME_SERIES_DAILY",
    symbol: ticker,
    outputsize: "compact"
  });

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  throwIfAlphaVantageError(data);

  const series = data?.["Time Series (Daily)"];
  if (!series || typeof series !== "object") {
    return {};
  }
  return series;
}

function selectOnOrBefore(series, targetDate) {
  const dates = Object.keys(series).filter((d) => d <= targetDate).sort();
  if (dates.length === 0) return null;
  const date = dates[dates.length - 1];
  const close = series[date]?.["4. close"];
  return {
    date,
    close: close ? Number(close) : null
  };
}

async function main() {
  if (!AV_KEY) {
    console.error("Missing ALPHAVANTAGE_API_KEY in .env");
    process.exit(1);
  }

  const rows = [];
  for (const ticker of TICKERS) {
    if (rateLimited) {
      rows.push({ ticker, error: "Rate limit reached. Skipped." });
      continue;
    }

    try {
      const series = await fetchSeries(ticker);
      const result = selectOnOrBefore(series, TARGET_DATE);
      if (!result) {
        rows.push({ ticker, error: "No data before target date." });
      } else {
        rows.push({ ticker, date: result.date, close: result.close });
      }
    } catch (err) {
      const rawMessage = err.message || "Unknown error";
      const message = sanitizeMessage(rawMessage);
      if (rawMessage.includes("Thank you for using Alpha Vantage") || rawMessage.includes("API call frequency") || rawMessage.includes("rate limit is")) {
        rateLimited = true;
        rows.push({ ticker, error: "Rate limit reached. Skipped." });
      } else {
        rows.push({ ticker, error: message });
      }
    }
  }

  const lines = [];
  lines.push(`# Historical Prices for ${TARGET_DATE}`);
  lines.push("");
  lines.push("Nearest trading day on or before the target date is used.");
  lines.push("");
  lines.push("| Ticker | Date Used | Close Price | Error |" );
  lines.push("| --- | --- | --- | --- |" );

  for (const row of rows) {
    const date = row.date || "";
    const close = row.close !== undefined && row.close !== null ? row.close.toFixed(2) : "";
    const error = row.error || "";
    lines.push(`| ${row.ticker} | ${date} | ${close} | ${error} |`);
  }

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUTPUT_FILE}`);
}

function sanitizeMessage(message) {
  if (!message) return "Unknown error";
  const redacted = message.replaceAll(AV_KEY, "[REDACTED]");
  if (redacted.includes("rate limit") || redacted.includes("Thank you for using Alpha Vantage")) {
    return "Rate limit reached.";
  }
  if (redacted.includes("Invalid API call")) {
    return "Invalid API call.";
  }
  return redacted;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
