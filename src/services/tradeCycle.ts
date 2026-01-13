import { config } from "../config";
import { logger } from "../utils/logger";
import { readJson, writeJson } from "../utils/storage";

export type TradeCycleState = {
	day: string;
	tradedSymbols: string[];
};

function currentUtcDay(): string {
	return new Date().toISOString().slice(0, 10);
}

function emptyCycle(day: string): TradeCycleState {
	return { day, tradedSymbols: [] };
}

async function saveCycle(state: TradeCycleState): Promise<void> {
	await writeJson(config.paths.tradeCycle, state);
}

export async function getCurrentTradeCycle(): Promise<TradeCycleState> {
	const today = currentUtcDay();
	const stored = await readJson<TradeCycleState>(
		config.paths.tradeCycle,
		emptyCycle(today),
	);

	if (stored.day !== today) {
		const fresh = emptyCycle(today);
		await saveCycle(fresh);
		logger.info({ previousDay: stored.day, day: today }, "Reset trade cycle");
		return fresh;
	}

	return stored;
}

export async function hasTradedInCurrentCycle(
	symbol: string,
): Promise<boolean> {
	const cycle = await getCurrentTradeCycle();
	return cycle.tradedSymbols.includes(symbol);
}

export async function markSymbolTraded(symbol: string): Promise<void> {
	const cycle = await getCurrentTradeCycle();
	if (cycle.tradedSymbols.includes(symbol)) return;

	const updated: TradeCycleState = {
		...cycle,
		tradedSymbols: [...cycle.tradedSymbols, symbol],
	};
	await saveCycle(updated);
	logger.info({ symbol, day: updated.day }, "Marked symbol as traded");
}
