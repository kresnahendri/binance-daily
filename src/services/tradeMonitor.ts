import type { EventEmitter } from "node:events";
import { fromEvent } from "rxjs";
import { filter } from "rxjs/operators";
import { getWsClient } from "../clients/binance";
import { sendTelegramMessage } from "../clients/telegram";
import { logger } from "../utils/logger";
import { closeTrade } from "./tradeStore";

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

function isOrderUpdate(msg: unknown): msg is OrderUpdateEvent {
	if (!msg || typeof msg !== "object") return false;
	const data = msg as Partial<OrderUpdateEvent>;
	return (
		data.eventType === "ORDER_TRADE_UPDATE" &&
		typeof (data as { order?: unknown }).order === "object"
	);
}

export function startTradeMonitor(): void {
	const ws = getWsClient();
	ws.subscribeUsdFuturesUserDataStream();

	fromEvent<OrderUpdateEvent>(ws as unknown as EventEmitter, "formattedMessage")
		.pipe(
			filter(isOrderUpdate),
			filter(
				(event) =>
					event.order.orderStatus === "FILLED" && event.order.isReduceOnly,
			),
		)
		.subscribe(async (event) => {
			const {
				symbol,
				averagePrice,
				originalQuantity,
				realisedProfit,
				orderSide,
			} = event.order;
			const direction = orderSide === "BUY" ? "Close Short" : "Close Long";
			const text = [
				`Trade closed ${symbol}`,
				direction,
				`Price: ${averagePrice}`,
				`Qty: ${originalQuantity}`,
				`PnL: ${realisedProfit}`,
			].join("\n");

			logger.info({ symbol, realisedProfit }, "Trade closed");
			await sendTelegramMessage(text);
			await closeTrade(symbol, averagePrice, realisedProfit);
		});
}
