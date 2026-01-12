## Strategy Scenarios (End-to-End)

These examples walk through the daily flow, entry logic, and exit paths so you can sanity‑check behaviour before live use. Assumes USDM testnet, quote asset USDT, `POSITION_SIZE_PCT=0.05`, `LEVERAGE=10`, `ATR_PERIOD=14`, `STOP_LOSS_BALANCE_PCT=0.01`, profit lock (`PROFIT_TRIGGER_PCT=0.05`, `LOCK_PERCENT_OF_TRIGGER=0.6`), `POSITION_CHECK_INTERVAL_SEC=30`, and initial available balance $100.

### 1) Daily run with no trades
- 00:00 UTC: ATR job pulls 1D klines, computes ATR(14) per symbol, writes `data/atr-cache.json`.
- 00:15 UTC: Candidate scan pulls closed 15m candle; if `high - low <= ATR`, symbol is skipped.
- Result: No candidates → no WS subscriptions; nothing else happens until next day.

### 2) Candidate found but no pattern
- 00:15 UTC: For `BTCUSDT`, 15m range > 25% of ATR → added as candidate, subscribed to 5m klines for 90 minutes; 15m candle color sets bias (green → only short signals, red → only long).
- Watcher checks each closed 5m candle pair for engulfing/hammer. If none appear in 90 minutes, subscription ends; no trade placed.

### 3) Long trade, normal win
- Entry signal: Bullish engulfing on 5m, 15m candle was red (so long bias allowed).
- Position sizing: Available balance $100 → margin = $5 (5%), notional = $50 with 10x leverage. At entry price $25,000, quantity ≈ 0.002, rounded to step size.
- Entry: Place chasing limit order at live price until filled; entry price recorded. No TP/SL orders are set at entry.
- Monitoring: Position manager runs every 30s. If total account PnL reaches +5% ($5), it sets a profit floor at 60% of that ($3). If price keeps rising, trade stays open; if it pulls back to +$3 total PnL, it exits at market (reduce-only).
- Outcome: Profit depends on where the floor is hit or if time-based exit fires.

### 4) Long trade, stop loss hit
- Same sizing as above.
- Price drops; total account PnL hits −1% of balance (STOP_LOSS_BALANCE_PCT). Position manager closes at market (reduce-only) on the next check (<=30s).
- Loss roughly equals the configured balance risk across all open trades, subject to slippage.

### 5) Profit lock triggers on balance-based gain (no static TP)
- Price moves favorably; total unrealized PnL reaches 5% of balance ($5 on $100).
- Position manager marks profit lock: sets floor = 60% of 5% = 3% of balance. No exchange stop orders are placed; closure happens via reduce-only market when floor is breached.
- If price pulls back to +3% total PnL, exit occurs; if it keeps running, trade stays open until time-based exit or manual stop.

### 6) Time-based exit
- Trade stays open past `TIME_BASED_EXIT_HOURS` (default 20h) without hitting profit trigger/floor or stop-loss threshold.
- Position manager force‑closes at market (reduce‑only), logs/alerts, and removes from open trades.

### 7) Run-now test (manual trigger)
- Set `RUN_CANDIDATE_ON_START=true` and start the bot (`bun run start`) to immediately run ATR (if needed) and the candidate scan instead of waiting for cron times. Position monitoring starts immediately at the configured interval.
- Useful to validate end‑to‑end signals and order placement on testnet intraday.

### 8) Edge cases
- **Step size/min notional**: If calculated quantity is below exchange limits, trade aborts with error.
- **Partial fills on entry**: Chasing limit loop aggregates partial fills until full size or throws if nothing fills.
- **No available balance**: Position manager skips profit/time checks and warns if available balance is zero.
- **WS disconnects**: Binance WS client auto‑reconnects; logs on reconnect/exception.
- **Multiple open trades**: PnL checks use aggregated unrealized PnL across all open positions to decide profit trigger/floor and stop-loss thresholds.
