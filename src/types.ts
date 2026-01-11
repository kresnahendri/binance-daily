export type Candle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type AtrSnapshot = {
  symbol: string;
  atr: number;
  day: string;
  calculatedAt: number;
};

export type AtrCache = Record<string, AtrSnapshot>;

export type VolatilityCandidate = {
  symbol: string;
  atr: number;
  range: number;
};

export type TradeSide = "BUY" | "SELL";

export type TradeSignalType =
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "bullish_hammer"
  | "bearish_hammer";

export type TradeIntent = {
  symbol: string;
  side: TradeSide;
  entry: number;
  atr: number;
  signal: TradeSignalType;
};

export type TradeRecord = {
  id: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  pnl?: number;
  signal: TradeSignalType;
  status: "OPEN" | "CLOSED";
};

export type SymbolMeta = {
  symbol: string;
  pair: string;
  quoteAsset: string;
  status: string;
  filters: Array<{ filterType: string; [key: string]: string | number }>;
};
