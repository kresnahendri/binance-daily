import { config } from "../config";
import type { TradeRecord } from "../types";
import { logger } from "../utils/logger";
import { readJson, writeJson } from "../utils/storage";

export async function loadOpenTrades(): Promise<TradeRecord[]> {
	const trades = await readJson<TradeRecord[]>(config.paths.openTrades, []);
	return trades.filter((t) => t.status === "OPEN");
}

async function saveOpenTrades(trades: TradeRecord[]): Promise<void> {
	await writeJson(config.paths.openTrades, trades);
}

export async function upsertOpenTrade(trade: TradeRecord): Promise<void> {
	const trades = await loadOpenTrades();
	const existingIndex = trades.findIndex((t) => t.id === trade.id);
	if (existingIndex >= 0) {
		trades[existingIndex] = trade;
	} else {
		trades.push(trade);
	}
	await saveOpenTrades(trades);
}

export async function removeOpenTrade(id: string): Promise<void> {
	const trades = await loadOpenTrades();
	const filtered = trades.filter((t) => t.id !== id);
	if (filtered.length !== trades.length) {
		await saveOpenTrades(filtered);
	}
}

export async function closeTrade(
	symbol: string,
	exitPrice: number,
	pnl: number,
): Promise<TradeRecord | null> {
	const trades = await loadOpenTrades();
	const idx = trades.findIndex((t) => t.symbol === symbol);
	if (idx < 0) return null;

	const trade = trades[idx];
	trade.status = "CLOSED";
	trade.exitPrice = exitPrice;
	trade.pnl = pnl;
	trade.closedAt = Date.now();

	trades.splice(idx, 1);
	await saveOpenTrades(trades);
	logger.info({ symbol, pnl }, "Closed trade in store");
	return trade;
}
