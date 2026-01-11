import type { Candle } from "../types";

export function calculateAtr(candles: Candle[], period: number): number {
	if (candles.length < period + 1) {
		throw new Error(`Not enough candles to calculate ATR(${period})`);
	}

	const trueRanges: number[] = [];

	for (let i = 1; i < candles.length; i++) {
		const prev = candles[i - 1];
		const curr = candles[i];
		const tr = Math.max(
			curr.high - curr.low,
			Math.abs(curr.high - prev.close),
			Math.abs(curr.low - prev.close),
		);
		trueRanges.push(tr);
	}

	const recent = trueRanges.slice(-period);
	const sum = recent.reduce((acc, val) => acc + val, 0);
	return sum / period;
}
