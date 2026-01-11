import { fromEvent } from "rxjs";
import { filter } from "rxjs/operators";
import { getWsClient } from "../clients/binance";
import { sendTelegramMessage } from "../clients/telegram";
import { logger } from "../utils/logger";

type OrderUpdateEvent = {
  eventType: "ORDER_TRADE_UPDATE";
  order: {
    symbol: string;
    orderSide: "BUY" | "SELL";
    orderStatus: string;
    averagePrice: number;
    originalQuantity: number;
    realisedProfit: number;
    stopPrice: number;
    isReduceOnly: boolean;
    executionType: string;
  };
};

function isOrderUpdate(msg: any): msg is OrderUpdateEvent {
  return msg?.eventType === "ORDER_TRADE_UPDATE" && msg?.order;
}

export function startTradeMonitor(): void {
  const ws = getWsClient();
  ws.subscribeUsdFuturesUserDataStream();

  fromEvent(ws as any, "formattedMessage")
    .pipe(
      filter(isOrderUpdate),
      filter((event) => event.order.orderStatus === "FILLED" && event.order.isReduceOnly)
    )
    .subscribe(async (event) => {
      const { symbol, averagePrice, originalQuantity, realisedProfit, orderSide } = event.order;
      const direction = orderSide === "BUY" ? "Close Short" : "Close Long";
      const text = [
        `Trade closed ${symbol}`,
        direction,
        `Price: ${averagePrice}`,
        `Qty: ${originalQuantity}`,
        `PnL: ${realisedProfit}`
      ].join("\n");

      logger.info({ symbol, realisedProfit }, "Trade closed");
      await sendTelegramMessage(text);
    });
}
