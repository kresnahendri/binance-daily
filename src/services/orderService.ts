import crypto from "node:crypto";
import {
	fetchTradingSymbols,
	restClient,
	symbolMeta,
} from "../clients/binance";
import { sendTelegramMessage } from "../clients/telegram";
import { config } from "../config";
import type { SymbolMeta, TradeIntent, TradeRecord, TradeSide } from "../types";
import { logger } from "../utils/logger";
import { logTrade } from "./tradeLogger";
import { hasTradedInCurrentCycle, markSymbolTraded } from "./tradeCycle";
import { upsertOpenTrade } from "./tradeStore";

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function oppositeSide(side: TradeSide): TradeSide {
	return side === "BUY" ? "SELL" : "BUY";
}

function ensureNumber(value: string | number | undefined): number {
	if (value === undefined) return 0;
	return typeof value === "number" ? value : Number(value);
}

function applyStepSize(quantity: number, meta: SymbolMeta): number {
	const marketLot = meta.filters.find(
		(f) => f.filterType === "MARKET_LOT_SIZE",
	) as { stepSize: string } | undefined;
	const lot = meta.filters.find((f) => f.filterType === "LOT_SIZE") as
		| { stepSize: string }
		| undefined;
	const step = marketLot?.stepSize || lot?.stepSize;
	if (!step) return quantity;

	const stepSize = Number(step);
	const adjusted = Math.floor(quantity / stepSize) * stepSize;
	return Number(adjusted.toFixed(8));
}

function applyTickSize(price: number, meta: SymbolMeta): number {
	const priceFilter = meta.filters.find(
		(f) => f.filterType === "PRICE_FILTER",
	) as { tickSize: string } | undefined;
	if (!priceFilter) return price;

	const tickSize = Number(priceFilter.tickSize);
	const precision = Math.max(0, Math.ceil(Math.abs(Math.log10(tickSize))));
	const adjusted = Math.round(price / tickSize) * tickSize;
	return Number(adjusted.toFixed(precision + 1));
}

async function ensureSymbolMeta(symbol: string): Promise<SymbolMeta> {
	if (!symbolMeta(symbol)) {
		await fetchTradingSymbols(config.strategy.quoteAsset);
	}
	const meta = symbolMeta(symbol);
	if (!meta) {
		throw new Error(`Symbol metadata not found for ${symbol}`);
	}
	return meta;
}

async function getAvailableBalance(asset: string): Promise<number> {
	const balances = await restClient.getBalanceV3();
	const match = balances.find((b) => b.asset === asset);
	if (!match) return 0;
	return Number(match.availableBalance);
}

function ensureNotional(
	quantity: number,
	price: number,
	meta: SymbolMeta,
): void {
	const notionalFilter = meta.filters.find(
		(f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL",
	) as { notional?: string; minNotional?: string } | undefined;

	if (!notionalFilter) return;

	const min = ensureNumber(
		notionalFilter.notional || notionalFilter.minNotional,
	);
	if (min && quantity * price < min) {
		throw new Error(`Notional too small. Minimum: ${min}`);
	}
}

async function latestPrice(symbol: string): Promise<number> {
	const ticker = await restClient.getSymbolPriceTicker({ symbol });
	return ensureNumber((ticker as { price: number | string }).price);
}

function formatEntryMessage(trade: TradeRecord): string {
	return [
		`New trade ${trade.symbol} (${trade.side})`,
		`Entry: ${trade.entryPrice}`,
		`Qty: ${trade.quantity}`,
		`SL ref: ${trade.stopLoss}`,
		`Signal: ${trade.signal}`,
	].join("\n");
}

function calculateLevels(
	intent: TradeIntent,
	entryPrice: number,
	quantity: number,
	availableBalance: number,
) {
	const atrStop =
		intent.side === "BUY" ? entryPrice - intent.atr : entryPrice + intent.atr;
	const takeProfit =
		intent.side === "BUY"
			? entryPrice + 2 * intent.atr
			: entryPrice - 2 * intent.atr;

	const riskAmount = availableBalance * config.strategy.stopLossBalancePct;
	const riskPerUnit = riskAmount / quantity;
	const balanceStop =
		intent.side === "BUY" ? entryPrice - riskPerUnit : entryPrice + riskPerUnit;

	const stopLoss =
		intent.side === "BUY"
			? Math.min(atrStop, balanceStop)
			: Math.max(atrStop, balanceStop);

	return { stopLoss, takeProfit };
}

async function placeChasingLimitOrder(
	intent: TradeIntent,
	quantity: number,
	meta: SymbolMeta,
): Promise<{ entryPrice: number; filledQty: number }> {
	let remaining = quantity;
	let totalFilled = 0;
	let totalCost = 0;
	let attempt = 0;

	while (remaining > 0) {
		attempt += 1;
		const livePrice = await latestPrice(intent.symbol);
		const limitPrice = applyTickSize(livePrice, meta);

		const order = await restClient.submitNewOrder({
			symbol: intent.symbol,
			side: intent.side,
			type: "LIMIT",
			quantity: remaining,
			price: limitPrice,
			timeInForce: "GTC",
		});

		logger.info(
			{
				symbol: intent.symbol,
				attempt,
				price: limitPrice,
				qty: remaining,
				orderId: order.orderId,
			},
			"Placed chasing limit order",
		);

		await sleep(10_000);

		const status = await restClient.getOrder({
			symbol: intent.symbol,
			orderId: order.orderId,
		});

		const executedQty = ensureNumber(status.executedQty);
		const avgPrice = ensureNumber(
			status.avgPrice || status.price || limitPrice,
		);
		const filledNow = Math.min(executedQty, remaining);

		if (filledNow > 0) {
			totalFilled += filledNow;
			totalCost += filledNow * avgPrice;
		}

		if (status.status === "FILLED" || totalFilled >= quantity) {
			const entryPrice = totalCost / totalFilled;
			return { entryPrice, filledQty: totalFilled };
		}

		remaining = quantity - totalFilled;

		await restClient
			.cancelOrder({ symbol: intent.symbol, orderId: order.orderId })
			.catch((err) => {
				logger.warn(
					{ symbol: intent.symbol, orderId: order.orderId, err },
					"Failed to cancel chasing limit order",
				);
			});
	}

	throw new Error("Chasing limit order loop ended unexpectedly");
}

export async function executeTrade(intent: TradeIntent): Promise<TradeRecord> {
	if (await hasTradedInCurrentCycle(intent.symbol)) {
		throw new Error(
			`${intent.symbol} already traded in the current cycle; skipping execution`,
		);
	}

	const meta = await ensureSymbolMeta(intent.symbol);

	const balance = await getAvailableBalance(config.strategy.quoteAsset);
	const margin = balance * config.strategy.positionSizePct;
	const notional = margin * config.strategy.leverage;

	let quantity = notional / intent.entry;
	quantity = applyStepSize(quantity, meta);
	ensureNotional(quantity, intent.entry, meta);

	if (quantity <= 0) {
		throw new Error(`Calculated quantity is zero for ${intent.symbol}`);
	}

	await restClient.setLeverage({
		symbol: intent.symbol,
		leverage: config.strategy.leverage,
	});

	const chaseResult = await placeChasingLimitOrder(intent, quantity, meta);
	const filledQty = chaseResult.filledQty;
	const entryPrice = chaseResult.entryPrice || intent.entry;
	if (filledQty <= 0) {
		throw new Error("No fills received from chasing limit order");
	}

	const levels = calculateLevels(
		{ ...intent, entry: entryPrice },
		entryPrice,
		filledQty,
		balance,
	);
	const adjustedSL = applyTickSize(levels.stopLoss, meta);
	const now = Date.now();

	const trade: TradeRecord = {
		id: crypto.randomUUID(),
		symbol: intent.symbol,
		side: intent.side,
		entryPrice,
		quantity: filledQty,
		stopLoss: adjustedSL,
		takeProfit: 0,
		openedAt: now,
		signal: intent.signal,
		status: "OPEN",
	};

	await logTrade(trade);
	await upsertOpenTrade(trade);
	try {
		await markSymbolTraded(intent.symbol);
	} catch (err) {
		logger.error(
			{ symbol: intent.symbol, err },
			"Failed to record trade in cycle store",
		);
	}
	await sendTelegramMessage(formatEntryMessage(trade));

	logger.info(
		{
			symbol: trade.symbol,
			side: trade.side,
			entry: entryPrice,
			qty: filledQty,
			stopPrice: adjustedSL,
		},
		"Limit chase order placed with TP/SL",
	);

	return trade;
}
