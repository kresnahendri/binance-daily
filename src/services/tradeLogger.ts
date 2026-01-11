import { config } from "../config";
import type { TradeRecord } from "../types";
import { logger } from "../utils/logger";
import { appendLine } from "../utils/storage";

export async function logTrade(record: TradeRecord): Promise<void> {
	await appendLine(config.paths.tradeLog, JSON.stringify(record));
	logger.info({ tradeId: record.id, symbol: record.symbol }, "Trade recorded");
}
