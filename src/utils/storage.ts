import fs from "node:fs/promises";
import path from "node:path";

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
	try {
		const content = await fs.readFile(filePath, "utf8");
		return JSON.parse(content) as T;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return fallback;
		}
		throw err;
	}
}

export async function writeJson(
	filePath: string,
	data: unknown,
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function appendLine(
	filePath: string,
	line: string,
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.appendFile(filePath, `${line}\n`, "utf8");
}
