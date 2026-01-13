import type { Candle, TradeSignalType } from "../types";

function toStockData(candles: Candle[], window: number) {
	const slice = candles.slice(-window);
	return {
		open: slice.map((c) => c.open),
		high: slice.map((c) => c.high),
		low: slice.map((c) => c.low),
		close: slice.map((c) => c.close),
	};
}

export function detectEngulfing(candles: Candle[]): TradeSignalType | null {
	if (candles.length < 2) return null;
	const [prev, curr] = candles.slice(-2);

	const prevBull = prev.close > prev.open;
	const prevBear = prev.close < prev.open;
	const currBull = curr.close > curr.open;
	const currBear = curr.close < curr.open;

	const prevBodyTop = Math.max(prev.open, prev.close);
	const prevBodyBottom = Math.min(prev.open, prev.close);
	const currBodyTop = Math.max(curr.open, curr.close);
	const currBodyBottom = Math.min(curr.open, curr.close);

	const currEngulfsPrev =
		currBodyTop >= prevBodyTop && currBodyBottom <= prevBodyBottom;

	if (prevBear && currBull && currEngulfsPrev) {
		return "bullish_engulfing";
	}
	if (prevBull && currBear && currEngulfsPrev) {
		return "bearish_engulfing";
	}

	return null;
}

export function detectHammer(candles: Candle[]): TradeSignalType | null {
	if (!candles.length) return null;
	const candle = candles[candles.length - 1];
	const body = Math.abs(candle.close - candle.open);
	const upperShadow = candle.high - Math.max(candle.open, candle.close);
	const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
	const range = candle.high - candle.low || 1;

	const longTailMultiplier = 2; // tail should be meaningfully longer than body
	const shadowShareThreshold = 0.6; // tail should dominate most of the range

	const hasBottomTail =
		lowerShadow >= longTailMultiplier * body &&
		lowerShadow / range >= shadowShareThreshold;
	const hasTopTail =
		upperShadow >= longTailMultiplier * body &&
		upperShadow / range >= shadowShareThreshold;

	if (hasBottomTail) return "bullish_hammer";
	if (hasTopTail) return "bearish_hammer";

	return null;
}
