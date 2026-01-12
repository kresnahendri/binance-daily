import type { EventEmitter } from "node:events";
import { fromEvent, merge, type Observable, timer } from "rxjs";
import {
	bufferCount,
	filter,
	map,
	share,
	take,
	takeUntil,
} from "rxjs/operators";
import { getWsClient } from "../clients/binance";
import { detectEngulfing, detectHammer } from "../patterns/candles";
import type {
	Candle,
	TradeIntent,
	TradeSide,
	VolatilityCandidate,
} from "../types";
import { logger } from "../utils/logger";

type KlinePayload = {
	startTime: number;
	closeTime: number;
	interval: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	isFinal: boolean;
};

type WsKlineEvent = {
	eventType: string;
	symbol: string;
	kline: KlinePayload;
};

function isKlineEvent(msg: unknown): msg is WsKlineEvent {
	if (!msg || typeof msg !== "object") return false;
	const data = msg as Partial<WsKlineEvent>;
	return data.eventType === "kline" && Boolean(data.kline && data.symbol);
}

function klineToCandle(kline: KlinePayload): Candle {
	return {
		openTime: kline.startTime,
		closeTime: kline.closeTime,
		open: Number(kline.open),
		high: Number(kline.high),
		low: Number(kline.low),
		close: Number(kline.close),
		volume: Number(kline.volume),
	};
}

function toTradeIntent(
	symbol: string,
	atr: number,
	candles: Candle[],
	bias: TradeSide,
): TradeIntent | null {
	const engulfing = detectEngulfing(candles);
	if (engulfing) {
		const side = engulfing.includes("bearish") ? "SELL" : "BUY";
		if (side !== bias) return null;
		return {
			symbol,
			atr,
			entry: candles[candles.length - 1].close,
			signal: engulfing,
			side,
		};
	}

	const hammer = detectHammer(candles);
	if (hammer) {
		const side = hammer.includes("bearish") ? "SELL" : "BUY";
		if (side !== bias) return null;
		return {
			symbol,
			atr,
			entry: candles[candles.length - 1].close,
			signal: hammer,
			side,
		};
	}

	return null;
}

export function watchCandidatesForSignals(
	candidates: VolatilityCandidate[],
	monitorMinutes: number,
): Observable<TradeIntent> {
	const ws = getWsClient();
	const topics = candidates.map((c) => `${c.symbol.toLowerCase()}@kline_5m`);

	if (topics.length > 0) {
		ws.subscribe(topics, "usdm");
		logger.info({ topics }, "Subscribed to kline streams for candidates");
	}

	const base$ = fromEvent<WsKlineEvent>(
		ws as unknown as EventEmitter,
		"formattedMessage",
	).pipe(
		filter(isKlineEvent),
		filter((event) => event.kline.interval === "5m"),
		filter((event) =>
			topics.includes(`${event.symbol.toLowerCase()}@kline_5m`),
		),
		filter((event) => event.kline.isFinal),
	);
	const shared$ = base$.pipe(share());

	const streams = candidates.map((candidate) => {
		const stop$ = timer(monitorMinutes * 60 * 1000);
		return shared$.pipe(
			filter((event) => event.symbol === candidate.symbol),
			map((event) => klineToCandle(event.kline)),
			bufferCount(5, 1),
			map((candles) =>
				toTradeIntent(
					candidate.symbol,
					candidate.atr,
					candles,
					candidate.preferredSide,
				),
			),
			filter((intent): intent is TradeIntent => Boolean(intent)),
			take(1),
			takeUntil(stop$),
		);
	});

	return merge(...streams);
}
