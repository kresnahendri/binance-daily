import { from, lastValueFrom } from "rxjs";
import { filter, map, mergeMap, tap, toArray } from "rxjs/operators";
import { fetchKlines, fetchTradingSymbols } from "../clients/binance";
import { config } from "../config";
import { calculateAtr } from "../indicators/atr";
import type { AtrCache, AtrSnapshot } from "../types";
import { logger } from "../utils/logger";
import { readJson, writeJson } from "../utils/storage";

export async function loadAtrCache(): Promise<AtrCache> {
	return readJson<AtrCache>(config.paths.atrCache, {});
}

export async function saveAtrCache(cache: AtrCache): Promise<void> {
	await writeJson(config.paths.atrCache, cache);
}

export async function refreshAtrCache(): Promise<AtrCache> {
	const symbols = await fetchTradingSymbols(config.strategy.quoteAsset);
	const period = config.strategy.atrPeriod;
	const day = new Date().toISOString().slice(0, 10);

	logger.info({ count: symbols.length }, "Refreshing ATR cache");

	const snapshots = await lastValueFrom(
		from(symbols).pipe(
			mergeMap(async (meta) => {
				try {
					const candles = await fetchKlines(meta.symbol, "1d", period + 2);
					if (candles.length <= period) return null;

					const atr = calculateAtr(candles, period);
					const snapshot: AtrSnapshot = {
						symbol: meta.symbol,
						atr,
						day,
						calculatedAt: Date.now(),
					};
					return snapshot;
				} catch (error) {
					logger.error(
						{ symbol: meta.symbol, error },
						"Failed to calculate ATR",
					);
					return null;
				}
			}, 8),
			filter((snapshot): snapshot is AtrSnapshot => Boolean(snapshot)),
			toArray(),
			tap((list) => logger.info({ count: list.length }, "ATR cache refreshed")),
			map((list) =>
				list.reduce<AtrCache>((acc, snapshot) => {
					acc[snapshot.symbol] = snapshot;
					return acc;
				}, {}),
			),
		),
	);

	await saveAtrCache(snapshots);
	return snapshots;
}
