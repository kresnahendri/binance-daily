## Binance Daily Trading (Futures)

TypeScript/RxJS pipeline that runs a daily USDM futures scan using the [`binance`](https://github.com/tiagosiebler/binance) SDK:

- 00:00 UTC: pull 1D klines for all TRADING symbols on the chosen quote asset (default USDT), compute ATR(14), and cache to `data/atr-cache.json`.
- 00:15 UTC: pull the first closed 15m candle; mark symbols where `high - low > ATR(14)` as candidates.
- Candidates stream 5m klines for 90 minutes; a bullish/bearish engulfing or hammer candle triggers a trade intent.
- Place a market order sized as `available quote balance * POSITION_SIZE_PCT * LEVERAGE / entry`, set SL at 1×ATR and TP at 2×ATR, both as reduce-only close orders.
- Trade events are logged to `data/trades.log` and Telegram notifications fire on entry/exit (user data stream).

### Setup
- Requirements: Node.js 18+.
- Install deps: `npm install`.
- Copy env template: `cp .env.example .env` and fill Binance API credentials (testnet by default), Telegram bot token/chat id, and strategy numbers.
- Run locally: `npm start` (schedules cron jobs) or `npm run dev` for watch mode. All times are UTC.
- Lint: `npm run lint` (Biome).

### Key configuration (env)
- `BINANCE_USE_TESTNET=true` is recommended until you confirm behaviour.
- `POSITION_SIZE_PCT` (margin fraction), `LEVERAGE`, `ATR_PERIOD`, `QUOTE_ASSET`, and cron times in `src/config/index.ts`.
- Exits: set `TIME_BASED_EXIT_HOURS` (default 20h) for max holding time, `PROFIT_TRIGGER_PCT` (default 5%) and `LOCK_PERCENT_OF_TRIGGER` (default 0.6) to lock in a portion of gains once the trigger is hit; monitor interval via `POSITION_CHECK_INTERVAL_SEC`.
- Files: ATR cache at `data/atr-cache.json`, trade log at `data/trades.log`.

### Notes
- Uses Binance USDM REST for scans and WebSocket streams for 5m klines plus user-data (order fills) via `WebsocketClient`.
- Quantity/price are snapped to exchange filters (step size, tick size); notional minimum is validated.
- Always verify on testnet before live funds; adjust patterns/filters as needed for your risk rules.
