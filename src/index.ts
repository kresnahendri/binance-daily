import cron from "node-cron";
import { sendTelegramMessage } from "./clients/telegram";
import { config } from "./config";
import { loadAtrCache, refreshAtrCache } from "./services/atrService";
import { scanVolatilityCandidates } from "./services/candidateScanner";
import { executeTrade } from "./services/orderService";
import { watchCandidatesForSignals } from "./services/patternWatcher";
import { startPositionManager } from "./services/positionManager";
import { startTradeMonitor } from "./services/tradeMonitor";
import { logger } from "./utils/logger";

async function runAtrJob(): Promise<void> {
	try {
		await refreshAtrCache();
	} catch (error) {
		logger.error({ error }, "ATR job failed");
		await sendTelegramMessage(`ATR job failed: ${String(error)}`);
	}
}

async function runCandidateJob(): Promise<void> {
	try {
		let atrCache = await loadAtrCache();
		if (Object.keys(atrCache).length === 0) {
			atrCache = await refreshAtrCache();
		}

		const candidates = await scanVolatilityCandidates(atrCache);
		if (!candidates.length) {
			logger.info("No volatility candidates found");
			return;
		}

		logger.info(
			{ symbols: candidates.map((c) => c.symbol) },
			"Watching candidates",
		);
		await sendTelegramMessage(
			`Watching ${candidates.length} candidates: ${candidates
				.map((c) => c.symbol)
				.join(", ")}`,
		);

		watchCandidatesForSignals(
			candidates,
			config.strategy.monitorMinutes,
		).subscribe({
			next: async (intent) => {
				try {
					await executeTrade(intent);
				} catch (error) {
					logger.error(
						{ symbol: intent.symbol, error },
						"Failed to execute trade",
					);
					await sendTelegramMessage(
						`Failed to execute trade ${intent.symbol}: ${String(error)}`,
					);
				}
			},
			error: (error) => logger.error({ error }, "Signal stream errored"),
			complete: () => logger.info("Signal watch finished"),
		});
	} catch (error) {
		logger.error({ error }, "Candidate job failed");
		await sendTelegramMessage(`Candidate scan failed: ${String(error)}`);
	}
}

function scheduleJobs() {
	cron.schedule(config.scheduling.atrCron, runAtrJob, {
		timezone: config.scheduling.timezone,
	});

	cron.schedule(config.scheduling.candidateCron, runCandidateJob, {
		timezone: config.scheduling.timezone,
	});
}

async function bootstrap() {
	logger.info("Starting Binance daily strategy");
	startTradeMonitor();
	startPositionManager();
	await runAtrJob();
	scheduleJobs();
}

bootstrap().catch((err) => {
	logger.error({ err }, "Fatal error");
});
