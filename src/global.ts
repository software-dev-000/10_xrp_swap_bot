import dotenv from 'dotenv';
import * as xrpl from 'xrpl';

dotenv.config()

export const client = new xrpl.Client(process.env.MAIN_WSS_RPC!);

export const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS

export const rankingEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

export const errorLog = (summary: string, error: any): void => {
    if (error?.response?.body?.description) {
        console.log('\x1b[31m%s\x1b[0m', `[error] ${summary} ${error.response.body.description}`);
    } else {
        console.log('\x1b[31m%s\x1b[0m', `[error] ${summary} ${error}`);
    }
};

export const parseError = (error: any): string => {
    let msg = '';
    try {
        error = JSON.parse(JSON.stringify(error));
        msg =
            error?.error?.reason ||
            error?.reason ||
            JSON.parse(error)?.error?.error?.response?.error?.message ||
            error?.response ||
            error?.message ||
            error;
    } catch (_error) {
        msg = error;
    }

    return msg;
};


export const get_bot_link = () => {
    return `https://t.me/${process.env.BOT_USERNAME}`
}

