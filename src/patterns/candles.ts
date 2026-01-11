import { Candle, TradeSignalType } from "../types";

export function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

const isBullish = (candle: Candle) => candle.close > candle.open;
const isBearish = (candle: Candle) => candle.close < candle.open;

export function detectEngulfing(prev: Candle, curr: Candle): TradeSignalType | null {
  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);

  if (prevBody === 0 || currBody === 0) {
    return null;
  }

  const openInsidePrev = curr.open <= prev.close && curr.open >= prev.open;
  const closeOutsidePrev = curr.close >= prev.open || curr.close <= prev.open;

  if (isBearish(prev) && isBullish(curr) && openInsidePrev && closeOutsidePrev) {
    return "bullish_engulfing";
  }

  if (isBullish(prev) && isBearish(curr) && openInsidePrev && closeOutsidePrev) {
    return "bearish_engulfing";
  }

  return null;
}

export function detectHammer(candle: Candle): TradeSignalType | null {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const range = candleRange(candle);

  if (range === 0 || body / range > 0.4) {
    return null;
  }

  if (lowerWick >= body * 2 && upperWick <= body * 0.6) {
    return "bullish_hammer";
  }

  if (upperWick >= body * 2 && lowerWick <= body * 0.6) {
    return "bearish_hammer";
  }

  return null;
}
