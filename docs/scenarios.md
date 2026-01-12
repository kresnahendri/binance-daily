## Strategy Scenarios (End-to-End)

These examples walk through the daily flow, entry logic, and exit paths so you can sanity‑check behaviour before live use. Assumes USDM testnet, quote asset USDT, `POSITION_SIZE_PCT=0.05`, `LEVERAGE=10`, `ATR_PERIOD=14`, `STOP_LOSS_BALANCE_PCT=0.01`, profit lock (`PROFIT_TRIGGER_PCT=0.05`, `LOCK_PERCENT_OF_TRIGGER=0.6`), and initial available balance $100.

### 1) Daily run with no trades
- 00:00 UTC: ATR job pulls 1D klines, computes ATR(14) per symbol, writes `data/atr-cache.json`.
- 00:15 UTC: Candidate scan pulls closed 15m candle; if `high - low <= ATR`, symbol is skipped.
- Result: No candidates → no WS subscriptions; nothing else happens until next day.

### 2) Candidate found but no pattern
- 00:15 UTC: For `BTCUSDT`, 15m range > 25% of ATR → added as candidate, subscribed to 5m klines for 90 minutes.
- Watcher checks each closed 5m candle pair for engulfing/hammer. If none appear in 90 minutes, subscription ends; no trade placed.

### 3) Long trade, normal win
- Entry signal: Bullish engulfing on 5m.
- Position sizing: Available balance $100 → margin = $5 (5%), notional = $50 with 10x leverage. At entry price $25,000, quantity ≈ 0.002, rounded to step size.
- Entry: Place chasing limit order at live price until filled; entry price recorded.
- Initial exits: SL at max(1×ATR distance, 1% of balance loss per the position); no static TP.
- Outcome: Price rises; profit lock can engage (below) or time-based exit can close. Profit depends on where the stop gets re-armed or when you manually close.

### 4) Long trade, stop loss hit
- Same sizing as above; SL distance uses wider of ATR vs balance risk.
- Price drops to SL; STOP_MARKET fills, trade closes; PnL roughly −1% of balance or −1×ATR move (whichever was larger at placement), subject to slippage.

### 5) Profit lock triggers on balance-based gain (no static TP)
- Price moves favorably; unrealized PnL reaches 5% of balance ($5 on $100).
- Position manager cancels existing exits and re‑arms:
  - New stop set to lock 60% of that $5 gain (≈$3), computed as price offset from entry based on position size.
- If price pulls back, the locked stop closes trade with ~+$3; if it keeps running, the stop stays in place until time-based exit or a further lock adjustment (if you add one).

### 6) Time-based exit
- Trade stays open past `TIME_BASED_EXIT_HOURS` (default 20h) without hitting TP/SL.
- Position manager force‑closes at market (reduce‑only), logs/alerts, and removes from open trades.

### 7) Run-now test (manual trigger)
- Set `RUN_CANDIDATE_ON_START=true` and start the bot (`bun run start`) to immediately run ATR (if needed) and the candidate scan instead of waiting for cron times.
- Useful to validate end‑to‑end signals and order placement on testnet intraday.

### 8) Edge cases
- **Step size/min notional**: If calculated quantity is below exchange limits, trade aborts with error.
- **Partial fills on entry**: Chasing limit loop aggregates partial fills until full size or throws if nothing fills.
- **No available balance**: Position manager skips profit/time checks and warns if available balance is zero.
- **WS disconnects**: Binance WS client auto‑reconnects; logs on reconnect/exception.
