import { from, lastValueFrom } from "rxjs";
import { filter, map, mergeMap, toArray } from "rxjs/operators";
import { fetchKlines } from "../clients/binance";
import type { AtrCache, TradeSide, VolatilityCandidate } from "../types";
import { logger } from "../utils/logger";

export async function scanVolatilityCandidates(
	atrCache: AtrCache,
): Promise<VolatilityCandidate[]> {
	const symbols = Object.keys(atrCache);

	if (symbols.length === 0) {
		return [];
	}

	return lastValueFrom(
		from(symbols).pipe(
			mergeMap(async (symbol) => {
				try {
					const candles = await fetchKlines(symbol, "15m", 2);
					const candle =
						candles[candles.length - 2] || candles[candles.length - 1];
					if (!candle) return null;
					if (candle.close === candle.open) return null;

					const range = candle.high - candle.low;
					const atr = atrCache[symbol].atr;
					const preferredSide: TradeSide =
						candle.close > candle.open ? "SELL" : "BUY";

					if (range > atr * 0.25) {
						return { symbol, atr, range, preferredSide };
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
