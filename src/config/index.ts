import path from "path";
import dotenv from "dotenv";

dotenv.config();

const useTestnet = (process.env.BINANCE_USE_TESTNET || "true").toLowerCase() === "true";
const futuresUrl =
  process.env.BINANCE_FUTURES_URL ||
  (useTestnet ? "https://testnet.binancefuture.com" : "https://fapi.binance.com");
const wsBase = useTestnet ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com";

export const config = {
  binance: {
    apiKey: process.env.BINANCE_API_KEY || "",
    apiSecret: process.env.BINANCE_API_SECRET || "",
    baseUrl: futuresUrl,
    wsBase
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || ""
  },
  strategy: {
    positionSizePct: Number(process.env.POSITION_SIZE_PCT || "0.01"),
    leverage: Number(process.env.LEVERAGE || "10"),
    atrPeriod: Number(process.env.ATR_PERIOD || "14"),
    quoteAsset: process.env.QUOTE_ASSET || "USDT",
    monitorMinutes: 90
  },
  scheduling: {
    atrCron: "0 0 * * *", // 00:00 UTC
    candidateCron: "15 0 * * *", // 00:15 UTC
    timezone: "UTC"
  },
  paths: {
    atrCache: path.join(process.cwd(), "data/atr-cache.json"),
    tradeLog: path.join(process.cwd(), "data/trades.log")
  }
};
