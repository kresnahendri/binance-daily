import { USDMClient, WebsocketClient } from "binance";
import { config } from "../config";
import { Candle, SymbolMeta } from "../types";
import { logger } from "../utils/logger";

const isTestnet = config.binance.baseUrl.includes("testnet");

export const restClient = new USDMClient({
  api_key: config.binance.apiKey,
  api_secret: config.binance.apiSecret,
  baseUrl: config.binance.baseUrl,
  beautifyResponses: true,
  testnet: isTestnet
});

const wsClient = new WebsocketClient({
  api_key: config.binance.apiKey,
  api_secret: config.binance.apiSecret,
  beautify: true,
  testnet: isTestnet
});

let cachedSymbols: SymbolMeta[] | null = null;

export function getWsClient(): WebsocketClient {
  return wsClient;
}

export async function fetchTradingSymbols(quoteAsset: string): Promise<SymbolMeta[]> {
  if (!cachedSymbols) {
    const info = await restClient.getExchangeInfo();
    cachedSymbols = info.symbols as unknown as SymbolMeta[];
  }

  return cachedSymbols.filter(
    (s) => s.status === "TRADING" && s.quoteAsset === quoteAsset && !s.symbol.includes("_")
  );
}

export async function fetchKlines(
  symbol: string,
  interval: "1d" | "15m" | "5m",
  limit: number
): Promise<Candle[]> {
  const data = await restClient.getKlines({ symbol, interval, limit });

  return data.map((kline) => ({
    openTime: kline[0],
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
    closeTime: kline[6]
  }));
}

export function symbolMeta(symbol: string): SymbolMeta | undefined {
  return cachedSymbols?.find((s) => s.symbol === symbol);
}

wsClient.on("reconnected", (data) => {
  logger.info({ wsKey: data?.wsKey }, "Binance WS reconnected");
});

wsClient.on("reconnecting", (data) => {
  logger.warn({ wsKey: data?.wsKey }, "Binance WS reconnecting");
});

wsClient.on("exception", (data) => {
  logger.error({ wsKey: data?.wsKey, error: data }, "Binance WS exception");
});
