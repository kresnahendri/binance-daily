import {
	bearishengulfingpattern,
	bullishengulfingpattern,
	hammerpattern,
} from "technicalindicators";
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
	const data = toStockData(candles, 2);
	if (bullishengulfingpattern(data)) return "bullish_engulfing";
	if (bearishengulfingpattern(data)) return "bearish_engulfing";
	return null;
}

export function detectHammer(candles: Candle[]): TradeSignalType | null {
	if (candles.length < 2) return null;
	const data = toStockData(candles, Math.min(candles.length, 5));
	const isHammer = hammerpattern(data);
	if (!isHammer) return null;
	const last = candles[candles.length - 1];
	return last.close >= last.open ? "bullish_hammer" : "bearish_hammer";
}
