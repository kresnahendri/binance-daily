import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const useTestnet =
	(process.env.BINANCE_USE_TESTNET || "true").toLowerCase() === "true";
const futuresUrl =
	process.env.BINANCE_FUTURES_URL ||
	(useTestnet
		? "https://testnet.binancefuture.com"
		: "https://fapi.binance.com");
const wsBase = useTestnet
	? "wss://stream.binancefuture.com"
	: "wss://fstream.binance.com";

export const config = {
	binance: {
		apiKey: process.env.BINANCE_API_KEY || "",
		apiSecret: process.env.BINANCE_API_SECRET || "",
		baseUrl: futuresUrl,
		wsBase,
	},
	telegram: {
		botToken: process.env.TELEGRAM_BOT_TOKEN || "",
		chatId: process.env.TELEGRAM_CHAT_ID || "",
	},
	strategy: {
		positionSizePct: Number(process.env.POSITION_SIZE_PCT || "0.01"),
		leverage: Number(process.env.LEVERAGE || "10"),
		atrPeriod: Number(process.env.ATR_PERIOD || "14"),
		quoteAsset: process.env.QUOTE_ASSET || "USDT",
		monitorMinutes: 90,
		timeBasedExitHours: Number(process.env.TIME_BASED_EXIT_HOURS || "20"),
		profitTriggerPct: Number(process.env.PROFIT_TRIGGER_PCT || "0.05"),
		lockPercentOfTrigger: Number(process.env.LOCK_PERCENT_OF_TRIGGER || "0.6"),
		positionCheckIntervalSec: Number(
			process.env.POSITION_CHECK_INTERVAL_SEC || "30",
		),
		stopLossBalancePct: Number(process.env.STOP_LOSS_BALANCE_PCT || "0.01"),
	},
	scheduling: {
		atrCron: "0 0 * * *", // 00:00 UTC
		candidateCron: "15 0 * * *", // 00:15 UTC
		timezone: "UTC",
		runCandidateOnStart:
			(process.env.RUN_CANDIDATE_ON_START || "false").toLowerCase() === "true",
	},
	paths: {
		atrCache: path.join(process.cwd(), "data/atr-cache.json"),
		tradeLog: path.join(process.cwd(), "data/trades.log"),
		openTrades: path.join(process.cwd(), "data/open-trades.json"),
		tradeCycle: path.join(process.cwd(), "data/trade-cycle.json"),
	},
};
