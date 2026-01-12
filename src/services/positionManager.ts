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
	totalPnlQuote: number,
	totalPnlPctOfBalance: number,
): Promise<void> {
	const isLong = trade.side === "BUY";
	const openSideMatches =
		(isLong && positionAmt > 0) || (!isLong && positionAmt < 0);
	if (!openSideMatches) return;

	const pnlQuote = positionPnl(trade.side, entryPrice, markPrice, positionAmt);
	const pnlPctOfBalance = pnlQuote / availableBalance;
	const hoursOpen = (Date.now() - trade.openedAt) / (1000 * 60 * 60);

	const shouldTimeClose = hoursOpen >= config.strategy.timeBasedExitHours;
	const stopLossHit =
		totalPnlPctOfBalance <= -config.strategy.stopLossBalancePct;
	const hitProfitTrigger =
		!trade.profitLockApplied &&
		totalPnlPctOfBalance >= config.strategy.profitTriggerPct;
	const floorHit =
		trade.profitLockApplied &&
		typeof trade.lockFloorPct === "number" &&
		totalPnlPctOfBalance <= trade.lockFloorPct;

	logger.info(
		{
			symbol: trade.symbol,
			side: trade.side,
			positionAmt,
			entryPrice,
			markPrice,
			pnlQuote,
			pnlPctOfBalance,
			totalPnlQuote,
			totalPnlPctOfBalance,
			hoursOpen,
			shouldTimeClose,
			stopLossHit,
			hitProfitTrigger,
			floorHit,
			lockFloorPct: trade.lockFloorPct,
		},
		"Monitoring position",
	);

	if (shouldTimeClose) {
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

	// Hard stop-loss on balance pct
	if (stopLossHit) {
		await closePositionNow(
			trade.symbol,
			oppositeSide(trade.side),
			Math.abs(positionAmt),
		);
		await removeOpenTrade(trade.id);
		logger.info(
			{ symbol: trade.symbol, pnlPctOfBalance },
			"Closed position due to stop-loss threshold",
		);
		await sendTelegramMessage(
			`Closed ${trade.symbol} at stop-loss threshold (${(
				config.strategy.stopLossBalancePct * 100
			).toFixed(2)}% of balance)`,
		);
		return;
	}

	// Profit trigger then floor close
	if (hitProfitTrigger) {
		trade.profitLockApplied = true;
		trade.lockFloorPct =
			config.strategy.profitTriggerPct * config.strategy.lockPercentOfTrigger;
		await upsertOpenTrade(trade);
		logger.info(
			{
				symbol: trade.symbol,
				pnlPctOfBalance,
				lockFloorPct: trade.lockFloorPct,
			},
			"Profit trigger reached; floor set",
		);
		await sendTelegramMessage(
			`Locked profit on ${trade.symbol}: floor set to ${(
				trade.lockFloorPct * 100
			).toFixed(2)}% of balance after reaching ${(
				pnlPctOfBalance * 100
			).toFixed(2)}%`,
		);
		return;
	}

	if (floorHit) {
		const floorPct = trade.lockFloorPct ?? 0;
		await closePositionNow(
			trade.symbol,
			oppositeSide(trade.side),
			Math.abs(positionAmt),
		);
		await removeOpenTrade(trade.id);
		logger.info(
			{ symbol: trade.symbol, pnlPctOfBalance, lockFloorPct: floorPct },
			"Closed position after profit floor hit",
		);
		await sendTelegramMessage(
			`Closed ${trade.symbol} after profit floor (${(
				floorPct * 100
			).toFixed(2)}% of balance)`,
		);
		return;
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

	const tradePositions: Array<{
		trade: TradeRecord;
		entryPrice: number;
		markPrice: number;
		positionAmt: number;
		pnlQuote: number;
	}> = [];

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
		const pnlQuote = positionPnl(trade.side, entryPrice, markPrice, positionAmt);
		tradePositions.push({
			trade,
			entryPrice,
			markPrice,
			positionAmt,
			pnlQuote,
		});
	}

	const totalPnlQuote = tradePositions.reduce(
		(sum, t) => sum + t.pnlQuote,
		0,
	);
	const totalPnlPctOfBalance =
		availableBalance > 0 ? totalPnlQuote / availableBalance : 0;

	for (const entry of tradePositions) {
		await handleTrade(
			entry.trade,
			entry.markPrice,
			entry.positionAmt,
			entry.entryPrice,
			availableBalance,
			totalPnlQuote,
			totalPnlPctOfBalance,
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
