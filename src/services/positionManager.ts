import { restClient } from "../clients/binance";
import { sendTelegramMessage } from "../clients/telegram";
import { config } from "../config";
import type { TradeRecord, TradeSide } from "../types";
import { logger } from "../utils/logger";
import { loadOpenTrades, removeOpenTrade, upsertOpenTrade } from "./tradeStore";

function oppositeSide(side: TradeSide): TradeSide {
	return side === "BUY" ? "SELL" : "BUY";
}

function positionPnl(
	side: TradeSide,
	entry: number,
	mark: number,
	qty: number,
): number {
	const diff = side === "BUY" ? mark - entry : entry - mark;
	return diff * Math.abs(qty);
}

async function cancelAndSetStops(
	trade: TradeRecord,
	lockPrice: number,
): Promise<void> {
	await restClient
		.cancelAllOpenOrders({ symbol: trade.symbol })
		.catch((err) => {
			logger.warn(
				{ symbol: trade.symbol, err },
				"Failed to cancel open orders",
			);
		});

	const exitSide = oppositeSide(trade.side);

	await restClient.submitNewOrder({
		symbol: trade.symbol,
		side: exitSide,
		type: "STOP_MARKET",
		stopPrice: lockPrice,
		closePosition: "true",
		reduceOnly: "true",
		workingType: "MARK_PRICE",
	});
}

async function closePositionNow(
	symbol: string,
	side: TradeSide,
	quantity: number,
): Promise<void> {
	await restClient.submitNewOrder({
		symbol,
		side,
		type: "MARKET",
		quantity,
		reduceOnly: "true",
	});
}

async function handleTrade(
	trade: TradeRecord,
	markPrice: number,
	positionAmt: number,
	entryPrice: number,
	availableBalance: number,
): Promise<void> {
	const isLong = trade.side === "BUY";
	const openSideMatches =
		(isLong && positionAmt > 0) || (!isLong && positionAmt < 0);
	if (!openSideMatches) return;

	const pnlQuote = positionPnl(trade.side, entryPrice, markPrice, positionAmt);
	const pnlPctOfBalance = pnlQuote / availableBalance;
	const hoursOpen = (Date.now() - trade.openedAt) / (1000 * 60 * 60);

	if (hoursOpen >= config.strategy.timeBasedExitHours) {
		await closePositionNow(
			trade.symbol,
			oppositeSide(trade.side),
			Math.abs(positionAmt),
		);
		await removeOpenTrade(trade.id);
		logger.info(
			{ symbol: trade.symbol },
			"Closed position due to time-based exit",
		);
		await sendTelegramMessage(
			`Closed ${trade.symbol} due to time limit (${config.strategy.timeBasedExitHours}h)`,
		);
		return;
	}

	if (
		!trade.profitLockApplied &&
		pnlPctOfBalance >= config.strategy.profitTriggerPct
	) {
		const triggerAmount = availableBalance * config.strategy.profitTriggerPct;
		const lockQuote = triggerAmount * config.strategy.lockPercentOfTrigger;
		const lockPrice =
			trade.side === "BUY"
				? entryPrice + lockQuote / Math.abs(positionAmt)
				: entryPrice - lockQuote / Math.abs(positionAmt);

		await cancelAndSetStops(trade, lockPrice);
		trade.stopLoss = lockPrice;
		trade.profitLockApplied = true;
		await upsertOpenTrade(trade);
		logger.info(
			{
				symbol: trade.symbol,
				lockPrice,
				pnlQuote,
				pnlPctOfBalance,
				lockQuote,
			},
			"Locked profit and updated stops",
		);
		await sendTelegramMessage(
			`Locked profit on ${trade.symbol}: stop set to ${lockPrice} after reaching ${(
				pnlPctOfBalance * 100
			).toFixed(2)}% of balance`,
		);
	}
}

async function monitorPositions(): Promise<void> {
	const openTrades = await loadOpenTrades();
	if (!openTrades.length) return;

	const balances = await restClient.getBalanceV3();
	const balanceRecord = balances.find(
		(b) => b.asset === config.strategy.quoteAsset,
	);
	const availableBalance = balanceRecord
		? Number(balanceRecord.availableBalance)
		: 0;
	if (availableBalance <= 0) {
		logger.warn("Skipping position monitor due to zero available balance");
		return;
	}

	const positions = await restClient.getPositionsV3();
	for (const trade of openTrades) {
		const pos = positions.find((p) => p.symbol === trade.symbol);
		if (!pos) {
			await removeOpenTrade(trade.id);
			continue;
		}

		const positionAmt = Number(pos.positionAmt);
		if (positionAmt === 0) {
			await removeOpenTrade(trade.id);
			continue;
		}

		const entryPrice = Number(pos.entryPrice) || trade.entryPrice;
		const markPrice = Number(pos.markPrice);
		await handleTrade(
			trade,
			markPrice,
			positionAmt,
			entryPrice,
			availableBalance,
		);
	}
}

export function startPositionManager(): void {
	const interval = Math.max(config.strategy.positionCheckIntervalSec, 5) * 1000;
	setInterval(() => {
		monitorPositions().catch((err) => {
			logger.error({ err }, "Position monitor failed");
		});
	}, interval);
	logger.info(
		{ intervalSeconds: interval / 1000 },
		"Started position manager for time-based exit and profit lock",
	);
}
