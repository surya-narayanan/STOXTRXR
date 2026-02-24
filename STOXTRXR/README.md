# STOXTRXR

Local web app to track current price, price on a chosen date (previous trading day if needed), and next earnings date.

## Setup

1. Copy `.env.example` to `.env` and add your `ALPHAVANTAGE_API_KEY`.
2. Install dependencies and run:

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## Notes
- Uses Alpha Vantage for quotes, historical prices, and earnings dates.
- If the selected date is a non-trading day, the app picks the most recent trading day before it.
