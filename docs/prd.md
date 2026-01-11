## Binance Daily Trading
I want to create daily trading in Binance futures using Typescript, node.js and rxjs. The trading strategy will be like this:
1. Scan all coins in 00:00 UTC with 1D time frame. in this step, I want to calculate the ATR(14) for each coin and store them.
2. in 00:15 UTC, Scan all coin with 15m time frame. Here, I want to calculate range of 15m candle (high - low) and compare it with ATR(14) from step 1. If the range of 15m candle is greater ATR(14), means the coin is volatile enough to trade, mark them as candidates.
3. For each candidate coin, I will watch the price action in 5m time frame for 90 minutes. If they have engulfing candle pattern (bullish or bearish) or hammer candle pattern (bullish or bearish), choose that coin to trade.
4. Place a market order with 1% of total balance as position size with 10x leverage. Set stop loss at 1 ATR(14) away from entry price. Set take profit at 2 ATR(14) away from entry price.
5. Monitor the trade. If the price hits take profit or stop loss, exit the trade.
6. Log all trades with entry price, exit price, stop loss, take profit, and profit/loss.
7. Use telegram bot to notify me when a trade is placed and when it is closed.
8. Repeat the process every day at the same time.

### Configuration
- Binance API Key and Secret
- Telegram Bot Token and Chat ID
- Trading parameters (e.g., position size, leverage, ATR period)