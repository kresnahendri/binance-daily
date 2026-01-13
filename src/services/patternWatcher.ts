import { fromEventPattern, merge, type Observable, timer } from "rxjs";
import { filter, map, scan, share, take, takeUntil, tap } from "rxjs/operators";
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

type WsKlineEventWithFinal = WsKlineEvent & { finalFlag: boolean };

function isKlineEvent(msg: unknown): msg is WsKlineEvent {
	if (!msg || typeof msg !== "object") return false;
	const data = msg as Partial<WsKlineEvent>;
	return Boolean(data.kline && data.symbol);
}

function isFinalKline(kline: Record<string, unknown>): boolean {
	if (!kline) return false;
	if (typeof kline.final === "boolean") return kline.final;
	if (typeof kline.isFinal === "boolean") return kline.isFinal;
	if (typeof kline.isKlineClosed === "boolean") return kline.isKlineClosed;
	if (typeof kline.isClosed === "boolean") return kline.isClosed;
	if (typeof kline.x === "boolean") return kline.x;
	return false;
}

function klineToCandle(kline: KlinePayload): Candle {
	const endTime =
		typeof (kline as unknown as Record<string, unknown>).endTime === "number"
			? ((kline as unknown as Record<string, unknown>).endTime as number)
			: undefined;
	return {
		openTime: kline.startTime,
		closeTime: kline.closeTime ?? endTime ?? kline.startTime + 5 * 60 * 1000,
		open: Number(kline.open),
		high: Number(kline.high),
		low: Number(kline.low),
		close: Number(kline.close),
		volume: Number(kline.volume),
	};
}

function respectsFifteenMinuteClose(
	side: TradeSide,
	fiveMinuteClose: number,
	fifteenMinuteClose: number,
): boolean {
	if (side === "SELL") return fiveMinuteClose > fifteenMinuteClose;
	return fiveMinuteClose < fifteenMinuteClose;
}

function toTradeIntent(
	candidate: VolatilityCandidate,
	candles: Candle[],
): TradeIntent | null {
	const { symbol, atr, preferredSide, fifteenMinuteCandle } = candidate;
	const latestClose = candles[candles.length - 1].close;
	const fifteenClose = fifteenMinuteCandle.close;

	const engulfing = detectEngulfing(candles);
	logger.info(
		{
			symbol,
			lastTwo: candles.slice(-2),
			engulfing,
		},
		"Engulfing check",
	);
	if (engulfing) {
		const side = engulfing.includes("bearish") ? "SELL" : "BUY";
		if (side !== preferredSide) return null;
		if (!respectsFifteenMinuteClose(side, latestClose, fifteenClose)) {
			logger.info(
				{
					symbol,
					side,
					latestClose,
					fifteenClose,
				},
				"Skipping engulfing signal; 5m close not aligned with 15m close",
			);
			return null;
		}
		return {
			symbol,
			atr,
			entry: latestClose,
			signal: engulfing,
			side,
		};
	}

	const hammer = detectHammer(candles);
	logger.info(
		{
			symbol,
			lastTwo: candles.slice(-2),
			hammer,
		},
		"Hammer check",
	);
	if (hammer) {
		const side = hammer.includes("bearish") ? "SELL" : "BUY";
		if (side !== preferredSide) return null;
		if (!respectsFifteenMinuteClose(side, latestClose, fifteenClose)) {
			logger.info(
				{
					symbol,
					side,
					latestClose,
					fifteenClose,
				},
				"Skipping hammer signal; 5m close not aligned with 15m close",
			);
			return null;
		}
		return {
			symbol,
			atr,
			entry: latestClose,
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

	const base$ = fromEventPattern<WsKlineEvent>(
		(handler: (data: unknown) => void) => {
			// Binance WebsocketClient is EventEmitter-compatible
			(
				ws as unknown as {
					on?: (ev: string, cb: (data: unknown) => void) => void;
				}
			).on?.("formattedMessage", handler);
		},
		(handler: (data: unknown) => void) => {
			(
				ws as unknown as {
					off?: (ev: string, cb: (data: unknown) => void) => void;
				}
			).off?.("formattedMessage", handler);
		},
	).pipe(
		filter(isKlineEvent),
		filter((event) => event.kline.interval === "5m"),
		filter((event) =>
			topics.includes(`${event.symbol.toLowerCase()}@kline_5m`),
		),
		map((event) => {
			const finalFlag = isFinalKline(event.kline as Record<string, unknown>);
			return { ...event, finalFlag } as WsKlineEventWithFinal;
		}),
		// tap((event) =>
		// 	logger.info(
		// 		{
		// 			symbol: event.symbol,
		// 			finalFlag: event.finalFlag,
		// 			keys: Object.keys(event.kline ?? {}),
		// 			rawIsFinal: event.kline.isFinal,
		// 			rawFinal: (event.kline as Record<string, unknown>).final,
		// 			rawClosed: (event.kline as Record<string, unknown>).isClosed,
		// 			rawX: (event.kline as Record<string, unknown>).x,
		// 			rawIsKlineClosed: (event.kline as Record<string, unknown>)
		// 				.isKlineClosed,
		// 		},
		// 		"Kline flags",
		// 	),
		// ),
		filter((event) => event.finalFlag),
		tap((event) =>
			logger.info(
				{
					symbol: event.symbol,
					closeTime: event.kline.closeTime,
					close: event.kline.close,
				},
				"Received final 5m kline",
			),
		),
	);
	const shared$ = base$.pipe(share());

	const streams = candidates.map((candidate) => {
		const stop$ = timer(monitorMinutes * 60 * 1000);
		return shared$.pipe(
			filter((event) => event.symbol === candidate.symbol),
			map((event) => klineToCandle(event.kline)),
			scan<Candle, Candle[]>((acc, candle) => {
				const next = [...acc, candle].slice(-2);
				return next;
			}, []),
			filter((candles) => candles.length === 2),
			tap((candles) =>
				logger.info(
					{ symbol: candidate.symbol, lastTwo: candles.slice(-2) },
					"Evaluating candle patterns",
				),
			),
			map((candles) => toTradeIntent(candidate, candles)),
			filter((intent): intent is TradeIntent => Boolean(intent)),
			take(1),
			takeUntil(stop$),
		);
	});

	return merge(...streams);
}
