import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import * as xrpl from 'xrpl';

import * as botLogic from './bot_logic';
import * as privateBot from './bot_private';
import * as database from './db';
import * as afx from './global';
import * as utils from './utils';
import { createReadStream } from 'fs';

dotenv.config();

export const COMMAND_START = "start";
export const COMMAND_WALLETS = "wallets";
export const COMMAND_TOKENS = "tokens";

export enum OptionCode {
    BACK = -100,
    LIMIT_ORDER_BACK,
    LIMIT_ORDER_ADD_BACK,
    CLOSE,
    TITLE,
    WELCOME = 0,
    MAIN_MENU,
    CREATE_TRUSTLINE,
    REMOVE_TRUSTLINE,
    BUY_1,
    BUY_5,
    BUY_10,
    BUY_50,
    BUY_X,
    SELL_10,
    SELL_25,
    SELL_50,
    SELL_100,
    SELL_X,
    BUY_USD,
    SELL_USD,
    MAIN_WITHDRAW,
    MAIN_IMPORT_WALLET,
    MAIN_EXPORT_WALLET,
    MAIN_GENERATE_WALLET,
    MAIN_REFRESH,
    MAIN_CHANGE_TOKEN,
    LIMIT_ORDER,
    LIMIT_ORDER_ADD,
    LIMIT_ORDER_EXPIRE,
    LIMIT_ORDER_PRICE_BUY,
    LIMIT_ORDER_PRICE_SELL,
    LIMIT_ORDER_PERCENT_BUY,
    LIMIT_ORDER_PERCENT_SELL,
    LIMIT_ORDER_CLOSEALL,
    WALLET_ID = 1000,
    TOKEN_ID = 2000,
}

export enum StateCode {
    IDLE = 1000,
    WAIT_TOKEN_CHANGE_ADRR,
    WAIT_WALLET_ADRR,
    WAIT_WALLET_SEED,
    WAIT_SET_BUY_AMOUNT,
    WAIT_SET_SELL_PERCENT,
    WAIT_SET_STEP_AMOUNT,
    WAIT_SET_USD_BUY_AMOUNT,
    WAIT_SET_USD_SELL_AMOUNT,
    WAIT_LIMIT_ORDER_TOKEN_ADDR,
    WAIT_LIMIT_ORDER_EXPIRE,
    WAIT_LIMIT_ORDER_PRICE_BUY,
    WAIT_LIMIT_ORDER_PRICE_SELL,
    WAIT_LIMIT_ORDER_PERCENT_BUY,
    WAIT_LIMIT_ORDER_PERCENT_SELL,
}

export let bot: TelegramBot;
export let myInfo: TelegramBot.User;
export const sessions = new Map();
export const stateMap = new Map();


export const stateMap_setFocus = (
    chatid: string,
    state: any,
    data: any = {}
) => {
    let item = stateMap.get(chatid);
    if (!item) {
        item = stateMap_init(chatid);
    }

    if (!data) {
        let focusData = {};
        if (item.focus && item.focus.data) {
            focusData = item.focus.data;
        }

        item.focus = { state, data: focusData };
    } else {
        item.focus = { state, data };
    }
};

export const stateMap_getFocus = (chatid: string) => {
    const item = stateMap.get(chatid);
    if (item) {
        let focusItem = item.focus;
        return focusItem;
    }

    return null;
};

export const stateMap_init = (chatid: string) => {
    let item = {
        focus: { state: StateCode.IDLE, data: { sessionId: chatid } },
        message: new Map(),
    };

    stateMap.set(chatid, item);

    return item;
};

export const stateMap_setMessage_Id = (
    chatid: string,
    messageType: number,
    messageId: number
) => {
    let item = stateMap.get(chatid);
    if (!item) {
        item = stateMap_init(chatid);
    }

    item.message.set(`t${messageType}`, messageId);
};

export const stateMap_getMessage = (chatid: string) => {
    const item = stateMap.get(chatid);
    if (item) {
        let messageItem = item.message;
        return messageItem;
    }

    return null;
};

export const stateMap_getMessage_Id = (chatid: string, messageType: number) => {
    const messageItem = stateMap_getMessage(chatid);
    if (messageItem) {
        return messageItem.get(`t${messageType}`);
    }

    return null;
};

export const stateMap_get = (chatid: string) => {
    return stateMap.get(chatid);
};

export const stateMap_remove = (chatid: string) => {
    stateMap.delete(chatid);
};

export const stateMap_clear = () => {
    stateMap.clear();
};

export const json_buttonItem = (key: string, cmd: number, text: string) => {
    return {
        text: text,
        callback_data: JSON.stringify({ k: key, c: cmd }),
    };
};

const json_url_buttonItem = (text: string, url: string) => {
    return {
        text: text,
        url: url,
    };
};

const json_webapp_buttonItem = (text: string, url: any) => {
    return {
        text: text,
        web_app: {
            url,
        },
    };
};

export const removeMenu = async (chatId: string, messageType: number) => {
    const msgId = stateMap_getMessage_Id(chatId, messageType);

    if (msgId) {
        try {
            await bot.deleteMessage(chatId, msgId);
        } catch (error) {
        }
    }
};

export const openMenu = async (
    chatId: string,
    messageType: number,
    menuTitle: string,
    json_buttons: any = []
) => {
    const keyboard = {
        inline_keyboard: json_buttons,
        resize_keyboard: false,
        one_time_keyboard: true,
        force_reply: true,
    };

    return new Promise(async (resolve, reject) => {
        await removeMenu(chatId, messageType);

        try {
            let msg: TelegramBot.Message = await bot.sendMessage(
                chatId,
                menuTitle,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                }
            );

            stateMap_setMessage_Id(chatId, messageType, msg.message_id);
            resolve({ messageId: msg.message_id, chatid: msg.chat.id });
        } catch (error) {
            afx.errorLog("openMenu", error);
            resolve(null);
        }
    });
};

export const openMessage = async (
    chatId: string,
    bannerId: string,
    messageType: number,
    menuTitle: string
) => {
    return new Promise(async (resolve, reject) => {
        await removeMenu(chatId, messageType);

        let msg: TelegramBot.Message;

        try {
            if (bannerId) {
                msg = await bot.sendPhoto(chatId, bannerId, {
                    caption: menuTitle,
                    parse_mode: "HTML",
                });
            } else {
                msg = await bot.sendMessage(chatId, menuTitle, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                });
            }

            stateMap_setMessage_Id(chatId, messageType, msg.message_id);
            resolve({ messageId: msg.message_id, chatid: msg.chat.id });
        } catch (error) {
            afx.errorLog("openMenu", error);
            resolve(null);
        }
    });
};

export async function switchMenu(
    chatId: string,
    messageId: number,
    title: string,
    json_buttons: any,
    parse_mode?: any
) {
    const keyboard = {
        inline_keyboard: json_buttons,
        resize_keyboard: true,
        one_time_keyboard: true,
        force_reply: true,
    };

    try {
        await bot.editMessageText(title, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard,
            disable_web_page_preview: true,
            parse_mode: parse_mode? parse_mode : "HTML",
        });
    } catch (error: any) {
        if (error.description === 'message is not modified') {
            // Ignore the error if the message is not modified
            return;
        }
        afx.errorLog("[switchMenuWithTitle]", error);
    }

}

export const replaceMenu = async (
    chatId: string,
    messageId: number,
    messageType: number,
    menuTitle: string,
    json_buttons: any = []
) => {
    const keyboard = {
        inline_keyboard: json_buttons,
        resize_keyboard: true,
        one_time_keyboard: true,
        force_reply: true,
    };

    return new Promise(async (resolve, reject) => {
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (error) {
            //afx.errorLog('deleteMessage', error)
        }

        await removeMenu(chatId, messageType);

        try {
            let msg: TelegramBot.Message = await bot.sendMessage(
                chatId,
                menuTitle,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                }
            );

            stateMap_setMessage_Id(chatId, messageType, msg.message_id);
            resolve({ messageId: msg.message_id, chatid: msg.chat.id });
        } catch (error) {
            afx.errorLog("openMenu", error);
            resolve(null);
        }
    });
};

export const get_menuTitle = (sessionId: string, subTitle: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return "ERROR " + sessionId;
    }

    let result =
        session.type === "private"
            ? `@${session.username}'s configuration setup`
            : `@${session.username} group's configuration setup`;

    if (subTitle && subTitle !== "") {
        //subTitle = subTitle.replace('%username%', `@${session.username}`)
        result += `\n${subTitle}`;
    }

    return result;
};

export const removeMessage = async (sessionId: string, messageId: number) => {
    if (sessionId && messageId) {
        try {
            await bot.deleteMessage(sessionId, messageId);
        } catch (error) {
            //console.error(error)
        }
    }
};

export const sendReplyMessage = async (chatid: string, message: string) => {
    try {
        let data: any = {
            parse_mode: "HTML",
            disable_forward: true,
            disable_web_page_preview: true,
            reply_markup: { force_reply: true },
        };

        const msg = await bot.sendMessage(chatid, message, data);
        return {
            messageId: msg.message_id,
            chatid: msg.chat ? msg.chat.id : null,
        };
    } catch (error) {
        afx.errorLog("sendReplyMessage", error);
        return null;
    }
};

export const sendMessage = async (
    chatid: string,
    message: string,
    info: any = {}
) => {
    try {
        let data: any = { parse_mode: "HTML" };

        data.disable_web_page_preview = true;
        data.disable_forward = true;

        if (info && info.message_thread_id) {
            data.message_thread_id = info.message_thread_id;
        }

        const msg = await bot.sendMessage(chatid, message, data);
        return {
            messageId: msg.message_id,
            chatid: msg.chat ? msg.chat.id : null,
        };
    } catch (error: any) {
        if (
            error.response &&
            error.response.body &&
            error.response.body.error_code === 403
        ) {
            info.blocked = true;
            if (
                error?.response?.body?.description ==
                "Forbidden: bot was blocked by the user"
            ) {
                database.removeUser({ chatid });
                sessions.delete(chatid);
            }
        }

        console.log(error?.response?.body);
        afx.errorLog("sendMessage", error);
        return null;
    }
};

export const sendInfoMessage = async (chatid: string, message: string) => {
    let json = [[json_buttonItem(chatid, OptionCode.CLOSE, "✖️ Close")]];

    return sendOptionMessage(chatid, message, json);
};

export const sendOptionMessage = async (
    chatid: string,
    message: string,
    option: any
) => {
    try {
        const keyboard = {
            inline_keyboard: option,
            resize_keyboard: true,
            one_time_keyboard: true,
        };

        const msg = await bot.sendMessage(chatid, message, {
            reply_markup: keyboard,
            disable_web_page_preview: true,
            parse_mode: "HTML",
        });
        return {
            messageId: msg.message_id,
            chatid: msg.chat ? msg.chat.id : null,
        };
    } catch (error) {
        afx.errorLog("sendOptionMessage", error);

        return null;
    }
};

export const pinMessage = (chatid: string, messageId: number) => {
    try {
        bot.pinChatMessage(chatid, messageId);
    } catch (error) {
        console.error(error);
    }
};

export const checkWhitelist = (chatid: string) => {
    return true;
};

export const getMainMenuMessage = async (
    sessionId: string
): Promise<string> => {
    const session = sessions.get(sessionId);
    if (!session) {
        return "";
    }

    if(!session.USD_addr)
        session.USD_addr = process.env.USD_ADDR || "USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"
    const [currency, issuer] = session.addr.split(".");
    let pendings = [];
    pendings.push(utils.getPairInfo(session.addr));
    pendings.push(utils.getTokenInfo(session.addr));
    pendings.push(database.selectUser({ chatid: sessionId }));
    const results1 = await Promise.all(pendings);
    // const pairInfo: any = results1[0]
    // const tokenInfo: any = results1[1]
    // const user: any = results1[2]
    session.pairInfo = results1[0];
    session.tokenInfo = results1[1];
    session.user = results1[2];
    const depositWallet = xrpl.Wallet.fromSeed(session.user.depositWallet);

    pendings = []
    pendings.push(utils.getXrpBalance(depositWallet.classicAddress))
    pendings.push(utils.getTokenBalance(depositWallet.classicAddress, session.addr))
    // pendings.push(utils.getTokenBalance(depositWallet.classicAddress, session.USD_addr))
    
    const results2 = await Promise.all(pendings)
    const walletBalance = results2[0];
    const tokenBalance = results2[1];
    // const USDBalance = results2[2];

    session.tokenBalance = tokenBalance;
    // session.USDBalance = USDBalance;
    session.walletBalance = walletBalance;
    session.user.limitOrderExpire = session.user.limitOrderExpire ?? 3600;

    const referrals: any = await database.countUsers({referredBy:sessionId})
    const earnings: number = session.user.referralEarning
    const xrpPrice: number = await utils.getXrpPrice()

    const MESSAGE = `🏅 Welcome to ${process.env.BOT_TITLE} 🏅.

🔗 Your referral link : 
${session.referralLink}
👭 Referrals : ${referrals}
💸 Total earnings : $ ${utils.roundDecimal(earnings * xrpPrice, 4)}

📌 Token: ${session.tokenInfo.symbol}
<code>${session.tokenInfo.address}</code>
💎 PRICE: ${session.pairInfo ? session.pairInfo.price +'$' : 'Unknown'}
📊 LP: ${session.pairInfo ? session.pairInfo.lp : 'Unknown'}
📊 MC: ${session.pairInfo ? session.pairInfo.mc : 'Unknown'}

First Ledger Url:
https://firstledger.net/token/${issuer}/${currency}

💳: <code>${depositWallet.address}</code> 
Token Balance: ${Number(tokenBalance).toFixed(3)}  
XRP Balance: ${Number(walletBalance)} XRP

How to use it:
Please deposit xrp to deposit wallet. Enter the token address to message input.
`

    return MESSAGE;
};

export const json_main = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return "";
    }

    const itemData = `${sessionId}`;
    const json = [
        [
            json_buttonItem(itemData, OptionCode.CREATE_TRUSTLINE, "Create TrustLine"),
            json_buttonItem(itemData, OptionCode.REMOVE_TRUSTLINE, "Remove TrustLine"),
        ],
        [
            json_buttonItem(itemData, OptionCode.BUY_1, "Buy 1XRP"),
            json_buttonItem(itemData, OptionCode.BUY_5, "Buy 5XRP"),
            json_buttonItem(itemData, OptionCode.BUY_10, "Buy 10XRP"),
            json_buttonItem(itemData, OptionCode.BUY_50, "Buy 50XRP"),
            json_buttonItem(itemData, OptionCode.BUY_X, "Buy X XRP"),
        ],
        [
            json_buttonItem(itemData, OptionCode.SELL_10, "Sell 10%"),
            json_buttonItem(itemData, OptionCode.SELL_25, "Sell 25%"),
            json_buttonItem(itemData, OptionCode.SELL_50, "Sell 50%"),
            json_buttonItem(itemData, OptionCode.SELL_100, "Sell 100%"),
            json_buttonItem(itemData, OptionCode.SELL_X, "Sell X %"),
        ],
        // [
        //     json_buttonItem(itemData, OptionCode.BUY_USD, "Buy USD"),
        //     json_buttonItem(itemData, OptionCode.SELL_USD, "Sell USD"),
        // ],
        [
            json_buttonItem(itemData, OptionCode.MAIN_WITHDRAW, " 📤 Withdraw"),
        ],
        [
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER, "Limit Order"),
        ],
        [
            json_buttonItem(itemData, OptionCode.MAIN_IMPORT_WALLET, "Import Wallet"),
            json_buttonItem(itemData, OptionCode.MAIN_GENERATE_WALLET, "Generate Wallet"),
            json_buttonItem(itemData, OptionCode.MAIN_EXPORT_WALLET, "Export Wallet"),
        ],
        [

            json_buttonItem(itemData, OptionCode.MAIN_REFRESH, "♻️ Refresh"),
            json_buttonItem(itemData, OptionCode.MAIN_CHANGE_TOKEN, "Change Token"),
        ]
    ];

    return { title: "", options: json };
};

export const limit_order_menu = async (title:string, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }

    const itemData = `${sessionId}`;

    let json: any[] = [];
    if(!title.includes("Here are your existing limit orders")) {
        json.push([
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_ADD , "Add Limit Order"),
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_BACK , "Back")
        ])
    } else {
        json.push([
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_ADD , "Add Limit Order"),
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_CLOSEALL , "Close All orders")
        ]);
        json.push([
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_BACK , "Back")
        ]);   
       
    }
    return { menu: json }
}

export const limit_order_add_menu = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }

    const itemData = `${sessionId}`;

    let json = [
        [
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_EXPIRE , `Expire ${session.user.limitOrderExpire } (sec) `),
        ],
        [
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_PRICE_BUY , "Buy at a specific price"),
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_PRICE_SELL , "Sell at a specific price"),
        ],
        [
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_PERCENT_BUY , "Buy with price change"),
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_PERCENT_SELL , "Sell with price change"),
        ],
        [
            json_buttonItem(itemData, OptionCode.LIMIT_ORDER_ADD_BACK , "Back"),
        ],
    ]

    return { menu: json }
}

export const get_wallets_menu = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }

    const user: any = await database.selectUser({ chatid: sessionId })

    const title = `Here are your wallets.`
    const itemData = `${sessionId}`;

    let json: any[] = [];
    const wallets = user.wallets;
    if (wallets && wallets.length > 0) {
        wallets.map((wallet: string, index: number) => {
            try {
                json.push(
                    [
                        json_buttonItem(itemData, OptionCode.WALLET_ID + index, xrpl.Wallet.fromSeed(wallet).address)
                    ]
                )
            } catch (err) {
                console.log("Wallet listing error:", err)
            }
        })
    }

    return { title, menu: json }
}

export const get_tokens_menu = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }

    const user: any = await database.selectUser({ chatid: sessionId })

    const title = `Here are your tokens.`
    const itemData = `${sessionId}`;

    let json: any[] = [];
    const tokens = user.tokens;
    if (tokens && tokens.length > 0) {
        tokens.map((token: string, index: number) => {
            try {
                json.push(
                    [
                        json_buttonItem(itemData, OptionCode.TOKEN_ID + index, token)
                    ]
                )
            } catch (err) {
                console.log("Wallet listing error:", err)
            }
        })
    }

    return { title, menu: json }
}

export const json_confirm = async (
    sessionId: string,
    msg: string,
    btnCaption: string,
    btnId: number,
    itemData: string = ""
) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }

    const title = msg;

    let json = [
        [
            json_buttonItem(sessionId, OptionCode.CLOSE, "Close"),
            json_buttonItem(itemData, btnId, btnCaption),
        ],
    ];
    return { title: title, options: json };
};

export const openConfirmMenu = async (
    sessionId: string,
    msg: string,
    btnCaption: string,
    btnId: number,
    itemData: string = ""
) => {
    const menu: any = await json_confirm(
        sessionId,
        msg,
        btnCaption,
        btnId,
        itemData
    );
    if (menu) {
        await openMenu(sessionId, btnId, menu.title, menu.options);
    }
};

export const createSession = async (
    chatid: string,
    username: string,
) => {
    let session: any = {};

    session.chatid = chatid;
    session.username = username;
    session.addr = "";
    session.referralLink = `https://t.me/${myInfo.username}?start=ref_${utils.encodeChatId(chatid)}`

    console.log(`[${session.username}] ----------->>>>>> ref link = ${session.referralLink}`)

    await setDefaultSettings(session);

    sessions.set(session.chatid, session);

    return session;
};

export function showSessionLog(session: any) {
    if (session.type === "private") {
        console.log(
            `@${session.username} user${session.wallet
                ? " joined"
                : "'s session has been created (" + session.chatid + ")"
            }`
        );
    } else if (session.type === "group") {
        console.log(
            `@${session.username} group${session.wallet
                ? " joined"
                : "'s session has been created (" + session.chatid + ")"
            }`
        );
    } else if (session.type === "channel") {
        console.log(
            `@${session.username} channel${session.wallet ? " joined" : "'s session has been created"
            }`
        );
    }
}

export const setDefaultSettings = async (session: any) => {
    session.timestamp = new Date().getTime();
    const depositWallet = utils.generateNewWallet();
    session.depositWallet = depositWallet?.seed;
};

export let busy: boolean = false
export async function init() {
    busy = true
    bot = new TelegramBot(process.env.BOT_TOKEN as string, {
        polling: true,
    });

    await bot.setMyCommands(
        [
            { command: "start", description: "Start a bot" },
            { command: "wallets", description: "List your wallets" },
            { command: "tokens", description: "List your tokens" }
        ]
    )

    bot.getMe().then((info: TelegramBot.User) => {
        myInfo = info;
    });

    bot.on("message", async (message: any) => {
        const msgType = message?.chat?.type;
        if (msgType === "private") {
            await privateBot.procMessage(message, database);
        }
    });

    bot.on(
        "callback_query",
        async (callbackQuery: TelegramBot.CallbackQuery) => {
            const message = callbackQuery.message;

            if (!message) {
                return;
            }

            await executeCommand(
                message.chat.id.toString(),
                message.message_id,
                callbackQuery.id,
                JSON.parse(callbackQuery.data as string)
            );
        }
    );

    busy = false
}

export const sessionInit = async () => {
    busy = true
    await database.init();
    await utils.getReservedVal();
    const users: any = await database.selectUsers();

    let loggedin = 0;
    for (const user of users) {
        let session = JSON.parse(JSON.stringify(user));
        session = utils.objectDeepCopy(session, ["_id", "__v"]);
        sessions.set(session.chatid, session);
    }

    console.log(
        `${users.length} users, ${loggedin} logged in`
    );
    busy = false
}

export const reloadCommand = async (
    chatid: string,
    messageId: number,
    callbackQueryId: string,
    option: any
) => {
    await removeMessage(chatid, messageId);
    executeCommand(chatid, messageId, callbackQueryId, option);
};

export const executeCommand = async (
    chatid: string,
    _messageId: number | undefined,
    _callbackQueryId: string | undefined,
    option: any
) => {
    const cmd = option.c;
    const id = option.k;

    const session = sessions.get(chatid);
    if (!session) {
        return;
    }

    const user: any = await database.selectUser({ chatid })
    if (!user) {
        console.log(`[${chatid}] user is not exist`)
        return
    }

    //stateMap_clear();

    let messageId = Number(_messageId ?? 0);
    let callbackQueryId = _callbackQueryId ?? "";

    const sessionId: string = chatid;
    const stateData: any = { sessionId, messageId, callbackQueryId, cmd };

    stateData.message_id = messageId
    stateData.callback_query_id = callbackQueryId

    try {
        if (cmd === OptionCode.MAIN_REFRESH) {
            // await removeMenu(chatid, messageId)
            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.MAIN_CHANGE_TOKEN) {
            await sendReplyMessage(
                chatid,
                `📨 Please enter the token contract address or any text/link containing contract address.`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_TOKEN_CHANGE_ADRR,
                stateData
            );
        } else if (cmd === OptionCode.LIMIT_ORDER) {
            const orders: any = await database.selectLimitOrders({ userid: session.user._id,  tokenAddr: session.tokenInfo.address})
            session.limitOrders = orders;
            const orderList = session.limitOrders && session.limitOrders.map((order:any) => `Type: ${order.orderType}, Target: ${order.targetPrice}, Order Amount: ${order.orderAmount}`).join('\n')
            const title = orderList ? `How to use it:\n\nIf you want to create limit order, you have to (0.2 + buy amount) of XRP balance in your wallet. XRP chain will take 0.2 XRP for each limit order while your order is persisted on the chain and will return it when your order is executed, expired or cancelled.\n\nHere are your existing limit orders.\n${orderList}` 
                : `How to use it:\n\nIf you want to create limit order, you have to (0.2 + buy amount) of XRP balance in your wallet. XRP chain will take 0.2 XRP for each limit order while your order is persisted on the chain and will return it when your order is executed, expired or cancelled.`

            const menu: any = await limit_order_menu(title, sessionId);

            await switchMenu(chatid, messageId, title, menu.menu);
        } else if (cmd === OptionCode.LIMIT_ORDER_BACK) {
            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.LIMIT_ORDER_EXPIRE) {
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message with expiration time in seconds.`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_LIMIT_ORDER_EXPIRE,
                stateData
            );
        } else if (cmd === OptionCode.LIMIT_ORDER_ADD) {
            if(session.addr) { 
                const menu: any = await limit_order_add_menu(sessionId);
                const title = `${session.tokenInfo.name}
<code>${session.tokenInfo.address} </code>
Current Price: <code>${session.pairInfo.price}</code>

Limit orders support take-profit and stop-loss.

Add orders based on specified prices or percentage changes.`
            await switchMenu(sessionId, stateData.message_id, title, menu.menu); 
            }

            else {
                await sendReplyMessage(
                    chatid,
                    `📨 Please enter the token contract address or any text/link containing contract address.`
                );
                stateData.menu_id = messageId
                stateMap_setFocus(
                    chatid,
                    StateCode.WAIT_LIMIT_ORDER_TOKEN_ADDR,
                    stateData
                );
            }

        } else if (cmd === OptionCode.LIMIT_ORDER_CLOSEALL) {
            const messageRet = await sendMessage(chatid, `Closing All limit orders...`);
            const messageId1 = messageRet!.messageId;
            const orders: any = await database.selectLimitOrders({ userid: session.user._id,  tokenAddr: session.tokenInfo.address})
            if(!orders)
                return;
            
            
            let pending:any = []
            for (const order of orders) {
                pending.push(await utils.cancelOffer(session.depositWallet, order.sequenceNum));
            }

            let res = await Promise.all(pending)

            if(res) {
                res = res.map(async (oneRes, index) => {
                    console.log(`order ${orders[index].sequenceNum} status => ${oneRes}`)
                    if(oneRes) {
                        // await database.updateLimitOrder({_id: orders[index]._id.toString('hex')});
                        await database.updateLimitOrder({sequenceNum : orders[index].sequenceNum});
                    }
                    return {
                        orderid: orders[index]._id,
                        seqenceNum: orders[index].sequenceNum,
                        res: oneRes
                    }
                })
    
                let messageId2:any
                let failedRes: any = res.filter((one:any) => one.res === false).map((one:any) => one.seqenceNum)
                if (failedRes.length === 0) {
                    const msRet = await sendMessage(chatid, `✅ Success`);
                    messageId2 = msRet!.messageId;
                    
                } else {
                    const title = failedRes.join('\n')
                    const msRet = await sendMessage(chatid, `⚠️ Order Cancellation of following orders are Failed\n${title}`);
                    messageId2 = msRet!.messageId;
                }
                utils.sleep(1000).then(() => {
                    removeMessage(chatid, messageId1)
                    if (failedRes.length === 0)
                        removeMessage(chatid, messageId2);
                });
    
                const updatedOrders: any = await database.selectLimitOrders({ userid: session.user._id,  tokenAddr: session.tokenInfo.address})
                const orderList = updatedOrders && updatedOrders.map((order:any) => `Type: ${order.orderType}, Target: ${order.targetPrice}, Order Amount: ${order.orderAmount}`).join('\n')
                const title = orderList ? `How to use it:\n\nIf you want to create limit order, you have to maintain (0.2 + buy amount) of XRP balance in your wallet.\n\nHere are your existing limit orders.\n${orderList}` 
                    : `How to use it:\n\nIf you want to create limit order, you have to maintain (0.2 + buy amount) of XRP balance in your wallet.`
                const menu: any = await limit_order_menu(title, sessionId);
                
                await switchMenu(chatid, messageId, title, menu.menu);
            }

            

        } else if (cmd === OptionCode.LIMIT_ORDER_PRICE_BUY || cmd === OptionCode.LIMIT_ORDER_PRICE_SELL) {
            const title = cmd === OptionCode.LIMIT_ORDER_PRICE_BUY ? `Please enter the expected price and auto-buy amount, separated by a comma. 

📍For example, entering 0.1,0.05 means buying automatically when the price reaches $0.1, and auto-buying 0.05 .
Current Price: <code>${session.pairInfo.price}</code> (Click to Copy)` : 
`Please enter the expected price and auto-buy amount, separated by a comma. 

📍For example, entering 0.1,0.05 means selling automatically when the price reaches $0.1, and auto-selling 0.05 .
Current Price: <code>${session.pairInfo.price}</code> (Click to Copy)`
            await sendReplyMessage(
                chatid,
                title
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                cmd === OptionCode.LIMIT_ORDER_PRICE_BUY ? StateCode.WAIT_LIMIT_ORDER_PRICE_BUY : StateCode.WAIT_LIMIT_ORDER_PRICE_SELL ,
                stateData
            );
        } else if (cmd === OptionCode.LIMIT_ORDER_PERCENT_BUY || cmd === OptionCode.LIMIT_ORDER_PERCENT_SELL) {
            const title = cmd === OptionCode.LIMIT_ORDER_PERCENT_BUY ? `Please enter the price change percentage and the automatic buy-in amount, separated by a comma. 
A positive number indicates an increase(take profit), while a negative number indicates a decrease(stop loss). 
For example:
📍20,0.05 means a 20% increase, buy 0.05
📍-20,0.05 means a 20% decrease, buy 0.05` 
            :
            `Please enter the price change percentage and the automatic sell amount, separated by a comma. 
A positive number indicates an increase(take profit), while a negative number indicates a decrease(stop loss). 
For example:
📍20,0.05 means a 20% increase, sell 0.05
📍-20,0.05 means a 20% decrease, sell 0.05`;

            await sendReplyMessage(
                chatid,
                title
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                cmd === OptionCode.LIMIT_ORDER_PERCENT_BUY ? StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY : StateCode.WAIT_LIMIT_ORDER_PERCENT_SELL,
                stateData
            );
        } else if (cmd === OptionCode.LIMIT_ORDER_ADD_BACK) {
            const updatedOrders: any = await database.selectLimitOrders({ userid: session.user._id,  tokenAddr: session.tokenInfo.address})
            const orderList = updatedOrders && updatedOrders.map((order:any) => `Type: ${order.orderType}, Target: ${order.targetPrice}, Order Amount: ${order.orderAmount}`).join('\n')
            const title = orderList ? `How to use it:\n\nIf you want to create limit order, you have to maintain (0.2 + buy amount) of XRP balance in your wallet.\n\nHere are your existing limit orders.\n${orderList}` 
                : `How to use it:\n\nIf you want to create limit order, you have to maintain (0.2 + buy amount) of XRP balance in your wallet.`
            const menu: any = await limit_order_menu(title, sessionId);

            await switchMenu(chatid, messageId, title, menu.menu);
        } else if (cmd === OptionCode.MAIN_MENU) {
            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await openMenu(chatid, cmd, title, menu.options);
        } else if (cmd === OptionCode.CREATE_TRUSTLINE) {
            const messageRet = await sendMessage(chatid, `Creating TrustLine...`);
            const messageId1 = messageRet!.messageId;

            const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
            const ret = await utils.createTrustline(wallet, session.addr, session.tokenInfo ? session.tokenInfo.totalSupply.toString() : "10000000000");
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.REMOVE_TRUSTLINE) {
            const messageRet = await sendMessage(chatid, `Removing Trustline...`);
            const messageId1 = messageRet!.messageId;

            const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
            const ret = await utils.removeTrustline(wallet, session.addr);
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.BUY_USD) {
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message with XRP amount you want to spend to buy USD.`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_SET_USD_BUY_AMOUNT,
                stateData
            );
        } else if (cmd === OptionCode.SELL_USD) {
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message percent of USD to sell`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_SET_USD_SELL_AMOUNT,
                stateData
            );
        } else if (cmd === OptionCode.BUY_X) {
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message with xrp amount to buy.`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_SET_BUY_AMOUNT,
                stateData
            );
        } else if (cmd === OptionCode.BUY_1 ||
            cmd === OptionCode.BUY_5 ||
            cmd === OptionCode.BUY_10 ||
            cmd === OptionCode.BUY_50
        ) {
            let buyAmount = 1
            if(cmd == OptionCode.BUY_5) buyAmount = 5
            if(cmd == OptionCode.BUY_10) buyAmount = 10
            if(cmd == OptionCode.BUY_50) buyAmount = 50
            const messageRet = await sendMessage(chatid, `Buying ${buyAmount} XRP...`);
            const messageId1 = messageRet!.messageId;
            const ret = await botLogic.buyToken(session.depositWallet, session.addr, buyAmount, session.token);
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;

                let taxFee = buyAmount * Number(process.env.BUY_FEE_PERCENT) / 100
                let referFee = 0
                const referralUser: any = await database.selectUser({ chatid: user.referredBy })
                if(referralUser) {
                    referFee = taxFee * Number(process.env.REFERRAL_FEE_PERCENT) / 100
                    taxFee -= referFee
                }

                const userWallet = xrpl.Wallet.fromSeed(session.depositWallet);
                if (taxFee > 0) {
                    const taxResult = await utils.sendXrpToAnotherWallet(userWallet, process.env.XRP_FEE_WALLET as string, taxFee)
                    if (taxResult && referFee > 0) {
                        const refUserWallet = xrpl.Wallet.fromSeed(referralUser.depositWallet);                
                        const referResult = await utils.sendXrpToAnotherWallet(userWallet, refUserWallet.address, referFee)                    
                        if(referResult) {
                            let totalEarning = referralUser.referralEarning
                            if(Number.isNaN(totalEarning)) totalEarning = 0;
                            totalEarning += referFee
                            referralUser.referralEarning = totalEarning;
                            database.updateUser(referralUser)
                        }
                    }
                }
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.SELL_X) {
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message with percent of token to sell`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_SET_SELL_PERCENT,
                stateData
            );
        } else if (cmd === OptionCode.SELL_10) {
            const messageRet = await sendMessage(chatid, `Selling 10% token...`);
            const messageId1 = messageRet!.messageId;
            const ret = await botLogic.sellToken(session.depositWallet, session.addr, 10);
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;
                if (process.env.XRP_FEE_WALLET && !isNaN(Number(process.env.SELL_FEE_AMOUNT)) && Number(process.env.SELL_FEE_AMOUNT) > 0) {
                    const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                    utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET, Number(process.env.SELL_FEE_AMOUNT))
                }
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.SELL_25) {
            const messageRet = await sendMessage(chatid, `Selling 25% token...`);
            const messageId1 = messageRet!.messageId;
            const ret = await botLogic.sellToken(session.depositWallet, session.addr, 25);
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;
                if (process.env.XRP_FEE_WALLET && !isNaN(Number(process.env.SELL_FEE_AMOUNT)) && Number(process.env.SELL_FEE_AMOUNT) > 0) {
                    const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                    utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET, Number(process.env.SELL_FEE_AMOUNT))
                }
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.SELL_50) {
            const messageRet = await sendMessage(chatid, `Selling 50% token...`);
            const messageId1 = messageRet!.messageId;
            const ret = await botLogic.sellToken(session.depositWallet, session.addr, 50);
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;
                if (process.env.XRP_FEE_WALLET && !isNaN(Number(process.env.SELL_FEE_AMOUNT)) && Number(process.env.SELL_FEE_AMOUNT) > 0) {
                    const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                    utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET, Number(process.env.SELL_FEE_AMOUNT))
                }
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.SELL_100) {
            const messageRet = await sendMessage(chatid, `Selling 100% token...`);
            const messageId1 = messageRet!.messageId;
            const ret = await botLogic.sellToken(session.depositWallet, session.addr, 100);
            let messageId2:any
            if (ret) {
                const msRet = await sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;
                if (process.env.XRP_FEE_WALLET && !isNaN(Number(process.env.SELL_FEE_AMOUNT)) && Number(process.env.SELL_FEE_AMOUNT) > 0) {
                    const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                    utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET, Number(process.env.SELL_FEE_AMOUNT))
                }
            } else {
                const msRet = await sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            utils.sleep(1000).then(() => {
                removeMessage(chatid, messageId1)
                removeMessage(chatid, messageId2);
            });

            const menu: any = json_main(sessionId);
            let title: string = await getMainMenuMessage(sessionId);

            await switchMenu(chatid, messageId, title, menu.options);
        } else if (cmd === OptionCode.MAIN_WITHDRAW) {
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message with your wallet address to withdraw.`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_WALLET_ADRR,
                stateData
            );
        } else if (cmd === OptionCode.MAIN_IMPORT_WALLET) {
            console.log("import wallet")
            await sendReplyMessage(
                chatid,
                `📨 Reply to this message with your wallet seed to import.`
            );
            stateData.menu_id = messageId
            stateMap_setFocus(
                chatid,
                StateCode.WAIT_WALLET_SEED,
                stateData
            );
        } else if (cmd === OptionCode.MAIN_GENERATE_WALLET) {
            const wallet = utils.generateNewWallet()
            session.depositWallet = wallet.seed;
            await database.updateUser(session);
            const menu: any = json_main(chatid);
            let title: string = await getMainMenuMessage(chatid);

            await await openMenu(chatid, cmd, title, menu.options);
        } else if (cmd === OptionCode.MAIN_EXPORT_WALLET) {
            if (session.depositWallet)
                try {
                    openMessage(chatid, "", 0, "⌛ Waiting for wallet seed txt.")
                    const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                    await botLogic.saveWalletSeedAsFile(session.depositWallet)

                    bot.sendDocument(sessionId, createReadStream(`./wallets/${wallet.address}.txt`))
                        .then(() => {
                            bot.sendMessage(sessionId, 'This document has got your wallet seed!');
                        })
                        .catch((error) => {
                            console.error('Error sending document:', error);
                            bot.sendMessage(sessionId, 'Sorry, there was an error sending the file.');
                        });
                } catch (error: any) {
                    sendMessage(chatid, error && error.message ? error.message : "Something went wrong! Try again later.");
                }
            else
                sendMessage(chatid, "No wallet!")
        } else if (cmd >= OptionCode.WALLET_ID && cmd < OptionCode.TOKEN_ID) {
            const user: any = await database.selectUser({ chatid });
            session.depositWallet = user.wallets[cmd - OptionCode.WALLET_ID];
            await database.updateUser(session);

            const menu: any = json_main(chatid);
            let title: string = await getMainMenuMessage(chatid);

            await await openMenu(chatid, cmd, title, menu.options);
        } else if (cmd >= OptionCode.TOKEN_ID) {
            const user: any = await database.selectUser({ chatid });
            session.addr = user.tokens[cmd - OptionCode.TOKEN_ID];
            await database.updateUser(session);

            const menu: any = json_main(chatid);
            let title: string = await getMainMenuMessage(chatid);

            await openMenu(chatid, cmd, title, menu.options);
        }
    } catch (error) {
        console.log(error);
        sendMessage(
            chatid,
            `😢 Sorry, Bot server restarted. Please try again with input token address 😉`
        );
        if (callbackQueryId)
            await bot.answerCallbackQuery(callbackQueryId, {
                text: `😢 Sorry, Bot server restarted. Please try again with input token address 😉`,
            });
    }
};
