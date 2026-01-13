import { from, lastValueFrom } from "rxjs";
import { filter, map, mergeMap, toArray } from "rxjs/operators";
import { fetchKlines } from "../clients/binance";
import type { AtrCache, TradeSide, VolatilityCandidate } from "../types";
import { getCurrentTradeCycle } from "./tradeCycle";
import { logger } from "../utils/logger";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function utcDayStart(timestamp: number): number {
	const date = new Date(timestamp);
	return Date.UTC(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate(),
		0,
		0,
		0,
		0,
	);
}

export async function scanVolatilityCandidates(
	atrCache: AtrCache,
): Promise<VolatilityCandidate[]> {
	const symbols = Object.keys(atrCache);

	if (symbols.length === 0) {
		return [];
	}

	const cycle = await getCurrentTradeCycle();
	const tradedSymbols = new Set(cycle.tradedSymbols);
	const dayStart = utcDayStart(Date.now());
	const expectedClose = dayStart + FIFTEEN_MINUTES_MS;

	return lastValueFrom(
		from(symbols).pipe(
			mergeMap(async (symbol) => {
				try {
					if (tradedSymbols.has(symbol)) {
						logger.info(
							{ symbol },
							"Skipping candidate already traded this cycle",
						);
						return null;
					}

					const candles = await fetchKlines(symbol, "15m", 1, {
						startTime: dayStart,
					});
					const candle = candles[0];
					if (!candle) return null;
					if (candle.openTime !== dayStart) {
						logger.warn(
							{
								symbol,
								openTime: candle.openTime,
								expected: dayStart,
							},
							"First 15m candle missing or not aligned to day start",
						);
						return null;
					}
					if (Date.now() < expectedClose) {
						logger.warn(
							{ symbol },
							"First 15m candle is not closed yet; skipping scan",
						);
						return null;
					}
					if (candle.close === candle.open) return null;

					const range = candle.high - candle.low;
					const atr = atrCache[symbol].atr;
					const preferredSide: TradeSide =
						candle.close > candle.open ? "SELL" : "BUY";

					if (range > atr * 0.25) {
						return {
							symbol,
							atr,
							range,
							preferredSide,
							fifteenMinuteCandle: candle,
						};
					}
					return null;
				} catch (error) {
					logger.error({ symbol, error }, "Failed to scan volatility");
					return null;
				}
			}, 5),
			filter((candidate): candidate is VolatilityCandidate =>
				Boolean(candidate),
			),
			toArray(),
			map((list) => list.sort((a, b) => b.range - a.range)),
		),
	);
}
