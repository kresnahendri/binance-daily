import crypto from "crypto";
import { config } from "../config";
import { fetchTradingSymbols, restClient, symbolMeta } from "../clients/binance";
import { sendTelegramMessage } from "../clients/telegram";
import { TradeIntent, TradeRecord, TradeSide, SymbolMeta } from "../types";
import { logger } from "../utils/logger";
import { logTrade } from "./tradeLogger";

function oppositeSide(side: TradeSide): TradeSide {
  return side === "BUY" ? "SELL" : "BUY";
}

function ensureNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function applyStepSize(quantity: number, meta: SymbolMeta): number {
  const marketLot = meta.filters.find((f) => f.filterType === "MARKET_LOT_SIZE") as
    | { stepSize: string }
    | undefined;
  const lot = meta.filters.find((f) => f.filterType === "LOT_SIZE") as { stepSize: string } | undefined;
  const step = marketLot?.stepSize || lot?.stepSize;
  if (!step) return quantity;

  const stepSize = Number(step);
  const adjusted = Math.floor(quantity / stepSize) * stepSize;
  return Number(adjusted.toFixed(8));
}

function applyTickSize(price: number, meta: SymbolMeta): number {
  const priceFilter = meta.filters.find((f) => f.filterType === "PRICE_FILTER") as
    | { tickSize: string }
    | undefined;
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

function ensureNotional(quantity: number, price: number, meta: SymbolMeta): void {
  const notionalFilter = meta.filters.find(
    (f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL"
  ) as { notional?: string; minNotional?: string } | undefined;

  if (!notionalFilter) return;

  const min = ensureNumber(notionalFilter.notional || notionalFilter.minNotional);
  if (min && quantity * price < min) {
    throw new Error(`Notional too small. Minimum: ${min}`);
  }
}

function entryLevels(intent: TradeIntent) {
  const stopLoss =
    intent.side === "BUY" ? intent.entry - intent.atr : intent.entry + intent.atr;
  const takeProfit =
    intent.side === "BUY" ? intent.entry + 2 * intent.atr : intent.entry - 2 * intent.atr;
  return { stopLoss, takeProfit };
}

function formatEntryMessage(trade: TradeRecord): string {
  return [
    `New trade ${trade.symbol} (${trade.side})`,
    `Entry: ${trade.entryPrice}`,
    `Qty: ${trade.quantity}`,
    `SL: ${trade.stopLoss}`,
    `TP: ${trade.takeProfit}`,
    `Signal: ${trade.signal}`
  ].join("\n");
}

export async function executeTrade(intent: TradeIntent): Promise<TradeRecord> {
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

  await restClient.setLeverage({ symbol: intent.symbol, leverage: config.strategy.leverage });

  const { stopLoss, takeProfit } = entryLevels(intent);
  const adjustedSL = applyTickSize(stopLoss, meta);
  const adjustedTP = applyTickSize(takeProfit, meta);

  const marketOrder = await restClient.submitNewOrder({
    symbol: intent.symbol,
    side: intent.side,
    type: "MARKET",
    quantity,
    newOrderRespType: "RESULT"
  });

  const entryPrice =
    ensureNumber(marketOrder.avgPrice) || ensureNumber(marketOrder.price) || intent.entry;
  const now = Date.now();

  const trade: TradeRecord = {
    id: crypto.randomUUID(),
    symbol: intent.symbol,
    side: intent.side,
    entryPrice,
    quantity,
    stopLoss: adjustedSL,
    takeProfit: adjustedTP,
    openedAt: now,
    signal: intent.signal,
    status: "OPEN"
  };

  const exitSide = oppositeSide(intent.side);

  await restClient.submitNewOrder({
    symbol: intent.symbol,
    side: exitSide,
    type: "STOP_MARKET",
    stopPrice: adjustedSL,
    closePosition: "true",
    reduceOnly: "true",
    workingType: "MARK_PRICE"
  });

  await restClient.submitNewOrder({
    symbol: intent.symbol,
    side: exitSide,
    type: "TAKE_PROFIT_MARKET",
    stopPrice: adjustedTP,
    closePosition: "true",
    reduceOnly: "true",
    workingType: "MARK_PRICE"
  });

  await logTrade(trade);
  await sendTelegramMessage(formatEntryMessage(trade));

  logger.info(
    { symbol: trade.symbol, side: trade.side, entry: entryPrice, qty: quantity },
    "Market order placed with TP/SL"
  );

  return trade;
}
