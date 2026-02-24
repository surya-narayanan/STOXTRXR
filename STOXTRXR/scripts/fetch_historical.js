import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MASSIVE_KEY = process.env.MASSIVE_API_KEY;
const MASSIVE_BASE = process.env.MASSIVE_BASE || "https://api.massive.com";
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

const MIN_INTERVAL_MS = 600;
let nextAvailable = 0;
let rateLimited = false;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextAvailable - now);
  nextAvailable = Math.max(nextAvailable, now) + MIN_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function fetchAggs(ticker) {
  await throttle();
  const fromDate = "2025-09-30";
  const url = `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromDate}/${TARGET_DATE}?adjusted=true&sort=asc&limit=5000`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${MASSIVE_KEY}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const rows = data?.results || [];
  return Array.isArray(rows) ? rows : [];
}

function selectOnOrBefore(rows, targetDate) {
  let best = null;
  for (const row of rows) {
    const rowDate = row?.t ? toISODate(new Date(row.t)) : null;
    if (!rowDate) continue;
    if (rowDate <= targetDate) {
      if (!best || rowDate > best.date) {
        best = { date: rowDate, close: row?.c ?? null };
      }
    }
  }
  return best;
}

async function main() {
  if (!MASSIVE_KEY) {
    console.error("Missing MASSIVE_API_KEY in .env");
    process.exit(1);
  }

  const rows = [];
  for (const ticker of TICKERS) {
    if (rateLimited) {
      rows.push({ ticker, error: "Rate limit reached. Skipped." });
      continue;
    }

    try {
      const rows = await fetchAggs(ticker);
      const result = selectOnOrBefore(rows, TARGET_DATE);
      if (!result) {
        rows.push({ ticker, error: "No data before target date." });
      } else {
        rows.push({ ticker, date: result.date, close: result.close });
      }
    } catch (err) {
      const rawMessage = err.message || "Unknown error";
      const message = sanitizeMessage(rawMessage);
      if (rawMessage.includes("rate limit") || rawMessage.includes("Too Many Requests")) {
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
  const redacted = message.replaceAll(MASSIVE_KEY, "[REDACTED]");
  if (redacted.includes("rate limit") || redacted.includes("Too Many Requests")) {
    return "Rate limit reached.";
  }
  return redacted;
}

function toISODate(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
