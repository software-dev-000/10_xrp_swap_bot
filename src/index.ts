import fs from "fs";
import path from "path";
import dotenv from 'dotenv';
dotenv.config()

import * as bot from './bot';

// const date = new Date();
// const logFilePath = path.join(process.cwd(), 'logs', `log_${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, '0')}_${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}_${String(date.getMinutes()).padStart(2, '0')}_${String(date.getSeconds()).padStart(2, '0')}.txt`);


// console.log(`file path: ${logFilePath}`);
// const checkLogFileSize = () => {
// 	const stats = fs.statSync(logFilePath);
// 	const fileSizeInMegabytes = stats.size / (1024 * 1024); // Convert bytes to MB
  
// 	if (fileSizeInMegabytes > 2) {
// 		const newLogFilePath = path.join(process.cwd(), `/logs/log_${Date.now()}.txt`);
// 		fs.renameSync(logFilePath, newLogFilePath); // Rename the old log file
// 		console.log(`Log file size exceeded 2 MB. Created new log file: ${newLogFilePath}`);
// 	}
// }
  
// const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });
console.log = function (...args) {
	// checkLogFileSize(); // Check log file size before writing
	const timestamp = new Date().toISOString();
	// logFile.write(`${timestamp} - ${args.join(' ')}\n`); // Write to log file
	process.stdout.write(`${timestamp} - ${args.join(' ')}\n`); // Optional: also log to console
};

const main = async () => {
	await bot.init()
	await bot.sessionInit()
}

main()

process.on("SIGSEGV", async (e) => {
	console.log(e);

	await bot.bot.stopPolling()
	await bot.bot.closeWebHook()
	await bot.bot.deleteWebHook()
	await bot.init()
	await bot.sessionInit()
})

process.on("uncaughtException", async (e) => {
	console.log(e);
	await bot.bot.stopPolling()
	await bot.bot.closeWebHook()
	await bot.bot.deleteWebHook()
	await bot.init()
})

