# STOXTRXR

Local web app to track current price, historical price on a selected date, and next earnings date for a list of tickers.

## Features
- Current price (latest daily close).
- Historical price on or before a selected date.
- Next earnings date.
- Sort by earnings date by clicking the column header.

## Requirements
- Node.js 18+ (for native `fetch`).
- An Alpha Vantage API key.

## Setup
1. Copy `/Users/surya/Documents/New project/STOXTRXR/.env.example` to `/Users/surya/Documents/New project/STOXTRXR/.env`.
2. Add your Alpha Vantage key:
   ```
   ALPHAVANTAGE_API_KEY=YOUR_KEY
   ```
3. Install and run:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:3000`.

## Defaults
On load, the app:
- Uses date `2025-11-01` (falls back to the most recent trading day if needed).
- Loads the default ticker list defined in `/Users/surya/Documents/New project/STOXTRXR/public/app.js`.

## Notes
- Alpha Vantage free tier has strict rate limits. If you add many tickers at once, some rows may show missing data.
- The "current price" is the latest daily close from Alpha Vantage.

## Snapshot file
A one-time historical snapshot is stored in:
- `/Users/surya/Documents/New project/STOXTRXR/historical_prices_2025-11-01.md`

To regenerate it:
```bash
node /Users/surya/Documents/New project/STOXTRXR/scripts/fetch_historical.js
```
