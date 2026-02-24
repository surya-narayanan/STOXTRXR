const tableBody = document.querySelector("#stocksTable tbody");
const tickerInput = document.querySelector("#tickerInput");
const dateInput = document.querySelector("#dateInput");
const addBtn = document.querySelector("#addBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const earningsHeader = document.querySelector("#earningsHeader");
const statusLine = document.querySelector("#statusLine");

let rows = [];
let sortAsc = true;
let apiHealthy = false;
const DEFAULT_DATE = "2025-11-01";
const DEFAULT_TICKERS = [
  "LITX", "SMCI", "AAOI", "LITE", "NBIS", "SNXX", "TTMI", "AEHR", "AMKR", "SNDK",
  "SMSMTY", "EWY", "UCTT", "CIEN", "ALAB", "KLIC", "ORCL", "COHR", "AVGO", "APH",
  "CSCO", "GOOGL", "GOOG", "SERV", "ONTO", "AMD", "NET", "IREN", "SFTBY", "FN",
  "SKYT", "CRDO", "MBLY", "VRT", "AMZN", "ACMR", "TER", "DT", "CRWV", "TOELY",
  "KEYS", "ENTG", "AAPL", "AMAT", "TSM", "VNET", "NVDA", "COHU", "SNPS", "VECO",
  "TEL", "MTSI", "UMC", "KLAC", "ASML", "GFS", "DOCN", "ASX", "MU", "ACLS",
  "INTC", "ARM", "ASYS", "APLD", "ICHR", "ANET", "CC", "NVMI", "LRCX", "SMTC",
  "TSEM", "FORM", "SYNA", "CAMT", "SITM", "WDC", "ON", "STX", "WDCX", "BTDR"
];

function setDefaultDate() {
  dateInput.value = DEFAULT_DATE;
}

function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(2);
}

function renderTable() {
  tableBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");

    const tickerCell = document.createElement("td");
    tickerCell.textContent = row.ticker;

    const currentCell = document.createElement("td");
    if (row.currentPrice !== null) {
      currentCell.textContent = formatPrice(row.currentPrice);
    } else {
      currentCell.textContent = "—";
      if (row.errors?.quote) {
        currentCell.title = row.errors.quote;
        currentCell.classList.add("cell-error");
      }
    }

    const histCell = document.createElement("td");
    if (row.historicalPrice !== null) {
      const suffix =
        row.historicalDate && row.historicalDate !== dateInput.value
          ? ` (${row.historicalDate})`
          : "";
      histCell.textContent = `${formatPrice(row.historicalPrice)}${suffix}`;
    } else {
      histCell.textContent = "—";
      if (row.errors?.history) {
        histCell.title = row.errors.history;
        histCell.classList.add("cell-error");
      }
    }

    const earningsCell = document.createElement("td");
    if (row.earningsDate) {
      earningsCell.textContent = row.earningsDate;
    } else {
      earningsCell.textContent = "—";
      if (row.errors?.earnings) {
        earningsCell.title = row.errors.earnings;
        earningsCell.classList.add("cell-error");
      }
    }

    tr.appendChild(tickerCell);
    tr.appendChild(currentCell);
    tr.appendChild(histCell);
    tr.appendChild(earningsCell);
    tableBody.appendChild(tr);
  }
}

function sortByEarnings() {
  rows.sort((a, b) => {
    const ad = a.earningsDate || "9999-12-31";
    const bd = b.earningsDate || "9999-12-31";
    return sortAsc ? ad.localeCompare(bd) : bd.localeCompare(ad);
  });
  sortAsc = !sortAsc;
}

function mergeRows(newRows) {
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  for (const row of newRows) {
    byTicker.set(row.ticker, row);
  }
  rows = Array.from(byTicker.values());
}

async function fetchRows(tickers) {
  if (!apiHealthy) {
    throw new Error("API checks failed. See status line above.");
  }
  const date = dateInput.value;
  const res = await fetch("/api/rows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers, date })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Request failed");
  }

  const data = await res.json();
  return data.rows || [];
}

async function addTickers() {
  const raw = tickerInput.value.trim();
  if (!raw) return;

  const tickers = raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  tickerInput.value = "";

  try {
    const newRows = await fetchRows(tickers);
    mergeRows(newRows);
    sortByEarnings();
    renderTable();
  } catch (err) {
    alert(err.message);
  }
}

async function refreshAll() {
  if (rows.length === 0) return;
  try {
    const tickers = rows.map((r) => r.ticker);
    const newRows = await fetchRows(tickers);
    rows = newRows;
    sortByEarnings();
    renderTable();
  } catch (err) {
    alert(err.message);
  }
}

addBtn.addEventListener("click", addTickers);
refreshBtn.addEventListener("click", refreshAll);
earningsHeader.addEventListener("click", () => {
  sortByEarnings();
  renderTable();
});

tickerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTickers();
});

dateInput.addEventListener("change", refreshAll);

setDefaultDate();

async function runHealthCheck() {
  statusLine.textContent = "Running API checks...";
  statusLine.classList.remove("error");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    apiHealthy = !!data.ok;
    if (apiHealthy) {
      statusLine.textContent = "API checks OK.";
      await loadDefaultTickers();
      return;
    }

    const failures = [];
    if (data?.checks?.series?.error) failures.push(`series: ${data.checks.series.error}`);
    if (data?.checks?.earnings?.error) failures.push(`earnings: ${data.checks.earnings.error}`);
    const message = failures.length > 0 ? failures.join(" | ") : (data?.error || "API checks failed.");
    statusLine.textContent = `API checks failed: ${message}`;
    statusLine.classList.add("error");
  } catch (err) {
    statusLine.textContent = `API checks failed: ${err.message}`;
    statusLine.classList.add("error");
  }
}

runHealthCheck();

async function loadDefaultTickers() {
  if (rows.length > 0) return;
  try {
    const newRows = await fetchRows(DEFAULT_TICKERS);
    rows = newRows;
    sortByEarnings();
    renderTable();
  } catch (err) {
    statusLine.textContent = `API checks OK, but default tickers failed: ${err.message}`;
    statusLine.classList.add("error");
  }
}
