import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function sendTelegramMessage(text: string): Promise<void> {
	if (!config.telegram.botToken || !config.telegram.chatId) {
		logger.warn("Telegram bot token or chat id missing, skipping notification");
		return;
	}

	const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

	await axios.post(url, {
		chat_id: config.telegram.chatId,
		text,
		parse_mode: "Markdown",
	});
}
