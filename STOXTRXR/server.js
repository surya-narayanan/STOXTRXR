import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;
const AV_BASE = process.env.ALPHAVANTAGE_BASE || "https://www.alphavantage.co";
const AV_MIN_INTERVAL_MS = 1100;
let avNextAvailable = 0;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireKey(req, res) {
  if (!AV_KEY) {
    res.status(500).json({ error: "Missing ALPHAVANTAGE_API_KEY in .env" });
    return false;
  }
  return true;
}

function toISODate(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(isoDate, delta) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toISODate(d);
}

async function fetchJson(url) {
  await throttleAlphaVantage(url);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchText(url) {
  await throttleAlphaVantage(url);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.text();
}

function avUrl(params) {
  const url = new URL(`${AV_BASE}/query`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", AV_KEY);
  return url.toString();
}

function getCurrentFromSeries(series) {
  const dates = Object.keys(series).sort();
  if (dates.length === 0) return null;
  const latest = dates[dates.length - 1];
  const close = series[latest]?.["4. close"];
  return close ? Number(close) : null;
}

function getHistoricalFromSeries(series, targetDate) {
  const dates = Object.keys(series).filter((d) => d <= targetDate).sort();
  if (dates.length === 0) return null;

  const date = dates[dates.length - 1];
  const close = series[date]?.["4. close"];
  return {
    date,
    close: close ? Number(close) : null
  };
}

async function getNextEarningsDate(ticker) {
  // Alpha Vantage earnings calendar returns CSV
  if (!AV_KEY) return null;

  const url = avUrl({
    function: "EARNINGS_CALENDAR",
    symbol: ticker,
    horizon: "12month"
  });

  const csv = await fetchText(url.toString());
  throwIfAlphaVantageCsvError(csv);
  const rows = parseCsv(csv);
  if (rows.length < 2) return null;

  const header = rows[0].map((h) => h.trim());
  const reportDateIdx = header.indexOf("reportDate");
  if (reportDateIdx === -1) return null;

  const today = toISODate(new Date());
  const upcoming = rows
    .slice(1)
    .map((r) => r[reportDateIdx]?.trim())
    .filter((d) => d && d >= today)
    .sort();

  return upcoming.length > 0 ? { date: upcoming[0] } : null;
}

async function getDailySeries(ticker) {
  const url = avUrl({
    function: "TIME_SERIES_DAILY",
    symbol: ticker,
    outputsize: "compact"
  });
  const data = await fetchJson(url);
  throwIfAlphaVantageError(data);
  const series = data?.["Time Series (Daily)"];
  if (!series || typeof series !== "object") return {};
  return series;
}

function throwIfAlphaVantageError(data) {
  const note = data?.Note || data?.Information;
  const err = data?.["Error Message"];
  if (note) {
    throw new Error(note);
  }
  if (err) {
    throw new Error(err);
  }
}

function throwIfAlphaVantageCsvError(csv) {
  const head = csv.slice(0, 200);
  if (head.includes("Thank you for using Alpha Vantage") || head.includes("API call frequency")) {
    throw new Error("Alpha Vantage rate limit reached.");
  }
  if (head.includes("Error Message") || head.includes("Invalid API call")) {
    throw new Error("Alpha Vantage returned an error for this symbol.");
  }
}

async function throttleAlphaVantage(url) {
  if (!url.includes("alphavantage.co")) return;
  const now = Date.now();
  const wait = Math.max(0, avNextAvailable - now);
  avNextAvailable = Math.max(avNextAvailable, now) + AV_MIN_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === "\"" && next === "\"") {
        field += "\"";
        i++;
      } else if (ch === "\"") {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === "\"") {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

app.get("/api/health", (req, res) => {
  if (!AV_KEY) {
    return res.json({
      ok: false,
      error: "Missing ALPHAVANTAGE_API_KEY in .env"
    });
  }

  const ticker = String(req.query.ticker || "AAPL").toUpperCase();
  const date = String(req.query.date || toISODate(new Date()));

  Promise.allSettled([
    getDailySeries(ticker),
    getNextEarningsDate(ticker)
  ]).then((results) => {
    const [seriesRes, earnRes] = results;

    const checks = {
      series: {
        ok: seriesRes.status === "fulfilled" && seriesRes.value && Object.keys(seriesRes.value).length > 0,
        error: seriesRes.status === "rejected" ? seriesRes.reason?.message : null
      },
      earnings: {
        ok: earnRes.status === "fulfilled" && earnRes.value !== null,
        error: earnRes.status === "rejected" ? earnRes.reason?.message : null
      }
    };

    const ok = checks.series.ok && checks.earnings.ok;
    res.json({ ok, ticker, date, checks });
  });
});

app.post("/api/rows", async (req, res) => {
  if (!requireKey(req, res)) return;

  const { tickers, date } = req.body || {};
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: "tickers[] is required" });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
  }

  try {
    const results = [];
    for (const raw of tickers) {
      const ticker = String(raw).trim().toUpperCase();
      if (!ticker) continue;

      const series = await safeCall(() => getDailySeries(ticker));
      const quote = series.value ? { value: getCurrentFromSeries(series.value), error: null } : { value: null, error: series.error };
      const hist = series.value ? { value: getHistoricalFromSeries(series.value, date), error: null } : { value: null, error: series.error };
      const earnings = await safeCall(() => getNextEarningsDate(ticker));

      results.push({
        ticker,
        currentPrice: quote.value ?? null,
        historicalPrice: hist.value?.close ?? null,
        historicalDate: hist.value?.date ?? null,
        earningsDate: earnings.value?.date ?? null,
        errors: {
          quote: quote.error,
          history: hist.error,
          earnings: earnings.error
        }
      });
    }

    res.json({ rows: results.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

async function safeCall(fn) {
  try {
    const value = await fn();
    return { value, error: null };
  } catch (err) {
    return { value: null, error: err.message || "Unknown error" };
  }
}

app.listen(PORT, () => {
  console.log(`STOXTRXR running on http://localhost:${PORT}`);
});
