## Binance Daily Trading
I want to create daily trading in Binance futures using Typescript, node.js and rxjs. The trading strategy will be like this:
1. Scan all coins in 00:00 UTC with 1D time frame. in this step, I want to calculate the ATR(14) for each coin and store them.
2. in 00:15 UTC, Scan all coin with 15m time frame. Here, calculate the range of the closed 15m candle (high - low) and compare it with ATR(14) from step 1. If the 15m range is greater than 25% of daily ATR, mark it as a candidate. Also capture 15m candle color (green → short bias, red → long bias).
3. For each candidate coin, watch closed 5m candles for 90 minutes. If the last two closed 5m candles form an engulfing pattern (bullish/bearish) or hammer (bullish/bearish), and the 15m bias agrees (green → only short signals, red → only long signals), choose that coin to trade.
4. Place a chasing limit order at the latest price (reduce slippage) sized at POSITION_SIZE_PCT of available balance with configured leverage. No static TP/SL orders are placed immediately.
5. Monitor positions on an interval (POSITION_CHECK_INTERVAL_SEC). Use aggregated PnL across all open positions, expressed as a % of account balance, for exits:
   - Time-based exit after TIME_BASED_EXIT_HOURS.
   - Hard stop if total PnL <= -STOP_LOSS_BALANCE_PCT of balance.
   - Profit lock: when total PnL >= PROFIT_TRIGGER_PCT of balance, set a floor at LOCK_PERCENT_OF_TRIGGER * PROFIT_TRIGGER_PCT; if PnL falls back to that floor, close at market (reduce-only).
6. Log all trades with entry price, exit price, stop loss, take profit, and profit/loss.
7. Use telegram bot to notify me when a trade is placed and when it is closed.
8. Repeat the process every day at the same time.

### Configuration
- Binance API Key and Secret
- Telegram Bot Token and Chat ID
- Trading parameters (e.g., position size, leverage, ATR period, bias filters, PnL thresholds, monitoring interval)
