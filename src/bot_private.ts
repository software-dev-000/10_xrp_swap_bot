import assert from 'assert';
import dotenv from 'dotenv';
import * as xrpl from 'xrpl';
import * as instance from './bot';
import * as logic from './bot_logic';
import {
    OptionCode,
    StateCode,
} from './bot';
import * as botLogic from './bot_logic';
import * as utils from './utils';

dotenv.config();

/*

start - welcome
snipe - snipe setting
wallet - manage your bot wallet
*/

const parseCode = async (database: any, session: any, wholeCode: string) => {
    let codes: string[] = wholeCode.split("_");
    console.log(codes);

    if (codes.length % 2 === 0) {
        for (let i = 0; i < codes.length; i += 2) {
            const type = codes[i];
            const code = codes[i + 1];

            if (type === "ref") {
                if (!session.referredBy) {
                    let referredBy: string = "";

                    referredBy = utils.decodeChatId(code);
                    if (referredBy === "" || referredBy === session.chatid) {
                        continue;
                    }

                    if (referredBy.length > 0) {
                        const refSession = instance.sessions.get(referredBy);
                        if (refSession) {
                            console.log(
                                `${session.username} has been invited by @${refSession.username} (${refSession.chatid})`
                            );
                        }

                        instance.sendInfoMessage(
                            referredBy,
                            `Great news! You have invited @${session.username}
You can earn 10% of their earning forever!`
                        );

                        session.referredBy = referredBy;
                        session.referredTimestamp = new Date().getTime();

                        await database.updateUser(session);
                    }
                }
            }
        }
    }
    return false;
};

export const procMessage = async (message: any, database: any) => {
    let chatid = message.chat.id.toString();
    let session = instance.sessions.get(chatid);
    let userName = message?.chat?.username;
    let messageId = message?.messageId;
    let stateNode = instance.stateMap_getFocus(chatid);
    const stateData = stateNode?.data;

    if (instance.busy) {
        return
    }

    if (message.photo) {
        console.log(message.photo);
        processSettings(message, database);
    }

    if (message.animation) {
        console.log(message.animation);
        processSettings(message, database);
    }

    if (!message.text) return;

    let command = message.text;
    if (message.entities) {
        for (const entity of message.entities) {
            if (entity.type === "bot_command") {
                command = command.substring(
                    entity.offset,
                    entity.offset + entity.length
                );
                break;
            }
        }
    }

    if (command.startsWith("/")) {
        if (!session) {
            if (!userName) {
                console.log(
                    `Rejected anonymous incoming connection. chatid = ${chatid}`
                );
                instance.sendMessage(
                    chatid,
                    `Welcome to ${process.env.BOT_TITLE} bot. We noticed that your telegram does not have a username. Please create username [Setting]->[Username] and try again.`
                );
                return;
            }

            session = await instance.createSession(chatid, userName);
            await database.updateUser(session);
            console.log(
                `@${userName} has been joined.`
            );
        }

        if (userName && session.username !== userName) {
            session.username = userName;
            await database.updateUser(session);
        }

        let params = message.text.split(" ");
        if (params.length > 0 && params[0] === command) {
            params.shift();
        }

        command = command.slice(1);

        if (command === instance.COMMAND_START) {
            let hideWelcome: boolean = false;
            if (params.length == 1 && params[0].trim() !== "") {
                let wholeCode = params[0].trim();
                hideWelcome = await parseCode(database, session, wholeCode);

                await instance.removeMessage(chatid, message.message_id);
            }

            await instance.executeCommand(
                chatid,
                undefined,
                undefined,
                { c: OptionCode.MAIN_MENU, k: `${chatid}` }
            );
        } else if (command === instance.COMMAND_WALLETS) {
            if (session.depositWallet) {
                const menuInfo = await instance.get_wallets_menu(chatid);
                if (menuInfo)
                    await instance.openMenu(chatid, 0, menuInfo.title, menuInfo.menu)
            }
        } else if (command === instance.COMMAND_TOKENS) {
            if (session.depositWallet) {
                const menuInfo = await instance.get_tokens_menu(chatid);
                if (menuInfo)
                    await instance.openMenu(chatid, 0, menuInfo.title, menuInfo.menu)
            }
        }
        // instance.stateMap_remove(chatid)
    } else if (message.reply_to_message) {
        processSettings(message, database);
        await instance.removeMessage(chatid, message.message_id); //TGR
        await instance.removeMessage(
            chatid,
            message.reply_to_message.message_id
        );
    } else if ((await utils.isValidTokenAddressOrUrl(command))) {
        if (!session) {
            session = await instance.createSession(chatid, userName);
            await database.updateUser(session);
            console.log(
                `@${userName} session has been logged.\n${session}`
            );
        }

        session.addr = utils.validateAddressAndTransform(command)
        session.USD_addr = utils.validateAddressAndTransform(process.env.USD_ADDR || "USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq")
        await database.updateUser(session);
        await instance.executeCommand(
            chatid,
            undefined,
            undefined,
            { c: OptionCode.MAIN_MENU, k: `${chatid}` }
        );
    } else {
        instance.openMessage(
            chatid, "", 0,
            `😉 Welcome to XRP Prime Bot. To get started, please enter token address or valid firstledger url.`
        );
    }
};

// let tokenInfo:any
const processSettings = async (msg: any, database: any) => {
    const sessionId = msg.chat?.id.toString();
    let messageId = msg?.messageId;

    const session = instance.sessions.get(sessionId);
    if (!session) {
        return;
    }

    const chatid = msg.chat?.id.toString()
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        console.log(`[${chatid}] user is not exist`)
        return
    }

    let stateNode = instance.stateMap_getFocus(sessionId);
    if (!stateNode) {
        instance.stateMap_setFocus(sessionId, StateCode.IDLE, {
            sessionId: sessionId,
        });
        stateNode = instance.stateMap_get(sessionId);

        assert(stateNode);
    }

    const stateData = stateNode.data;

    if (stateNode.state === StateCode.WAIT_SET_BUY_AMOUNT) {
        const value = Number(msg.text.trim());
        if (isNaN(value)) {
            instance.openMessage(
                sessionId, "", 0,
                `⛔ Sorry, the token amount you entered is invalid. Please try again`
            );
            return;
        }

        const messageRet = await instance.sendMessage(sessionId, `Buying ${value} XRP...`);
        const messageId1 = messageRet!.messageId;
        const ret = await botLogic.buyToken(session.depositWallet, session.addr, value, session.tokenInfo);
        let messageId2: any
        if (ret) {
            const msRet = await instance.sendMessage(sessionId, `✅ Success`);
            messageId2 = msRet!.messageId;
            
            let taxFee = value * Number(process.env.BUY_FEE_PERCENT) / 100
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
            const msRet = await instance.sendMessage(sessionId, `⚠️ Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_SET_USD_BUY_AMOUNT) {
        const value = Number(msg.text.trim());
        if (isNaN(value)) {
            instance.openMessage(
                sessionId, "", 0,
                `⛔ Sorry, the USD amount you entered is invalid. Please try again`
            );
            return;
        }

        const USD_ADDR = session.USD_addr;

        const messageRet = await instance.sendMessage(sessionId, `Buying USD with ${value} XRP ...`);
        const messageId1 = messageRet!.messageId;
        const ret = await botLogic.buyToken(session.depositWallet, USD_ADDR, value);
        let messageId2: any
        if (ret) {
            const msRet = await instance.sendMessage(sessionId, `✅ Success`);
            messageId2 = msRet!.messageId;
            
            let taxFee = value * Number(process.env.BUY_FEE_PERCENT) / 100
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
            const msRet = await instance.sendMessage(sessionId, `⚠️Buying USD Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_SET_USD_SELL_AMOUNT) {
        const value = Number(msg.text.trim());
        if (isNaN(value) || value > 100) {
            instance.openMessage(
                sessionId, "", 0,
                `⛔ Sorry, the percent of USD sell amount you entered is invalid. Please try again`
            );
            return;
        }

        const USD_ADDR = session.USD_addr;

        const messageRet = await instance.sendMessage(sessionId, `Selling ${value}% USD...`);
        const messageId1 = messageRet!.messageId;
        const ret = await botLogic.sellToken(session.depositWallet, USD_ADDR, value);
        let messageId2:any
        if (ret) {
            const msRet = await instance.sendMessage(sessionId, `✅ Selling USD Success`);
            messageId2 = msRet!.messageId;
            if (process.env.XRP_FEE_WALLET && !isNaN(Number(process.env.SELL_FEE_AMOUNT)) && Number(process.env.SELL_FEE_AMOUNT) > 0) {
                const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET, Number(process.env.SELL_FEE_AMOUNT))
            }
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Selling USD Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_SET_SELL_PERCENT) {
        const value = Number(msg.text.trim());
        if (isNaN(value) || value > 100) {
            instance.openMessage(
                sessionId, "", 0,
                `⛔ Sorry, the delay time you entered is invalid. Please try again`
            );
            return;
        }

        const messageRet = await instance.sendMessage(sessionId, `Selling ${value}% token...`);
        const messageId1 = messageRet!.messageId;
        const ret = await botLogic.sellToken(session.depositWallet, session.addr, value);
        let messageId2:any
        if (ret) {
            const msRet = await instance.sendMessage(sessionId, `✅ Success`);
            messageId2 = msRet!.messageId;
            if (process.env.XRP_FEE_WALLET && !isNaN(Number(process.env.SELL_FEE_AMOUNT)) && Number(process.env.SELL_FEE_AMOUNT) > 0) {
                const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
                utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET, Number(process.env.SELL_FEE_AMOUNT))
            }
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_TOKEN_CHANGE_ADRR) {
        const value = msg.text.trim();
        if (!await utils.isValidTokenAddressOrUrl(value)) {
            instance.openMessage(
                sessionId, "", 0,
                `⛔ Sorry, the token address you entered is invalid. Please try again`
            );
            return;
        }

        session.addr = utils.validateAddressAndTransform(value);
        await database.updateUser(session);
        await instance.executeCommand(
            chatid,
            undefined,
            undefined,
            { c: OptionCode.MAIN_MENU, k: `${chatid}` }
        );
    } else if (stateNode.state === StateCode.WAIT_WALLET_ADRR) {
        const value = msg.text.trim();
        const messageRet = await instance.sendMessage(sessionId, `Withdrawing...`);
        const messageId1 = messageRet!.messageId;

        const ret = await botLogic.withdraw(sessionId, value)
        let messageId2:any
        if (ret) {
            const msRet = await instance.sendMessage(sessionId, `✅ Success`);
            messageId2 = msRet!.messageId;
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_WALLET_SEED) {
        try {
            const value = msg.text.trim();
            const wallet = xrpl.Wallet.fromSeed(value);
            session.depositWallet = wallet.seed;
            await database.updateUser(session)
            const menu: any = instance.json_main(sessionId);
            let title: string = await instance.getMainMenuMessage(sessionId);

            await instance.openMenu(sessionId, OptionCode.MAIN_GENERATE_WALLET, title, menu.options);
        } catch (err: any) {
            await instance.sendMessage(sessionId, "⚠️ Invalid seed");
        }
    } else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_TOKEN_ADDR) {
        const value = msg.text.trim();
        session.addr = value;

        let pendings = [];
        pendings.push(utils.getPairInfo(session.addr));
        pendings.push(utils.getTokenInfo(session.addr));
        const results1 = await Promise.all(pendings);

        session.pairInfo = results1[0];
        session.tokenInfo = results1[1];

        let messageId:any;
        if (session.tokenInfo) {
            const menu: any = await instance.limit_order_add_menu(sessionId);
    
            const title = `${session.tokenInfo.name}
<code>${session.tokenInfo.address} </code>(Click to Copy)
Current Price: <code>${session.pairInfo.price}</code>

Limit orders support take-profit and stop-loss.

Add orders based on specified prices or percentage changes.`
            await instance.switchMenu(sessionId, stateData.message_id, title, menu.menu);    
            
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️Fetching Token Information Failed`);
            messageId = msRet!.messageId;
        }
    } else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_EXPIRE) {
        const value = msg.text.trim();
        session.user.limitOrderExpire = value;
        await database.updateUser(session);

        const menu: any = await instance.limit_order_add_menu(sessionId);
        const title = `${session.tokenInfo.name}
<code>${session.tokenInfo.address} </code>
Current Price: <code>${session.pairInfo.price}</code>

Limit orders support take-profit and stop-loss.

Add orders based on specified prices or percentage changes.`
        await instance.switchMenu(sessionId, stateData.message_id, title, menu.menu); 

    } else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY || stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_SELL) {
        const value = msg.text.trim();
        const [desiredPrice, orderAmount] = value.split(",")

        const messageRet = await instance.sendMessage(chatid, `Creating Limit Order with a specific price...`);
        const messageId1 = messageRet!.messageId;
        
        let messageId2:any
        if (session.user && session.tokenInfo) {
            console.log(`desiredPrice => ${desiredPrice}, orderAmount => ${orderAmount}`)
            if (session.walletBalance < 0.2) {
                const temp = await instance.sendMessage(
                    chatid,
                    `⚠️ Order creation Failed! To create limit orders, you need to have at least 0.2 XRP in your wallet.`
                );
                instance.removeMessage(chatid, messageId1)
                utils.sleep(10000).then(() => {
                    instance.removeMessage(chatid, temp!.messageId);
                });
                return;
            }

            if (!(session.tokenBalance > 0)) {
                const temp = await instance.sendMessage(
                    chatid,
                    `⚠️ Order creation Failed! To create sell limit orders, you need to have some tokens in your wallet.`
                );
                instance.removeMessage(chatid, messageId1)
                utils.sleep(10000).then(() => {
                    instance.removeMessage(chatid, temp!.messageId);
                });
                return;
            }
            // if you want to create limit order with USD then this code will be needed
            // if (session.USDBalance === 0) {
            //     const temp = await instance.sendMessage(
            //         chatid,
            //         `⚠️ Order creation Failed! To create limit orders, you need to have some USD in your wallet.`
            //     );
            //     instance.removeMessage(chatid, messageId1)
            //     utils.sleep(10000).then(() => {
            //         instance.removeMessage(chatid, temp!.messageId);
            //     });
            //     return;
            // }
           
            const [sequenceNum, txHash ] = await utils.createOffer(
                session.depositWallet, //wallet
                session.tokenInfo.address,  //token addr
                stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY ? "buy" : "sell",  // order type
                parseFloat(desiredPrice.trim().replace('$', '')), // target amount 
                parseFloat(orderAmount.trim()), // order amount
                session.user.limitOrderExpire // expiration in seconds
            )

            if(sequenceNum && txHash) {
                const msRet = await instance.sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;

                const limitOrder = await database.createLimitOrder({
                    userid: user._id,
                    tokenAddr: session.tokenInfo.address,
                    tokenName: session.tokenInfo.name,
                    orderType: stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY ? "price_buy" : "price_sell",
                    // sequenceNum: Date.now(),
                    sequenceNum: sequenceNum,
                    txHash: txHash,
                    targetPrice: value.split(",")[0].trim().replace('$', ''),
                    orderAmount: value.split(",")[1].trim(),
                    status: 1,
                })
                
                // start monitoring if order is executed
                
                console.log(`monitoring offers for ${session.user.username}'s token: ${session.tokenInfo.address}...`)
                setInterval(async () => {
                    const orders: any = await database.selectLimitOrders({ userid: session.user._id,  tokenAddr: session.tokenInfo.address})
                    const existingOrders = await utils.getOffers(session.depositWallet);
                    const executedOrders = orders.filter((order: any) => {
                        let flag = true;
                        for (const existingOrder of existingOrders) {
                            if (existingOrder.seq === order.sequenceNum) {
                                flag = false;
                                break;
                            }
                        }
                        return flag
                    });

                    if (executedOrders.length === 0) return;
                    await instance.sendMessage(chatid, `Following orders are executed!\n\n${executedOrders.map((order: any) => `Token: ${order.tokenName}, Type: ${order.orderType}, Target: ${order.targetPrice}, Order Amount: ${order.orderAmount}`).join('\n')}`);
                    
                    for (const order of executedOrders) {
                        await database.updateLimitOrder({sequenceNum : order.sequenceNum});
                    }
                }, 5 * 1000);

                const menu: any = await instance.limit_order_add_menu(sessionId);
                const title = `offer created for ${session.tokenInfo.name} !
sequence number : ${sequenceNum}
TxHash : <code>${txHash}</code>`
                await instance.switchMenu(sessionId, stateData.message_id, title, menu.menu);
            } else {
                const msRet = await instance.sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Getting user and token information Failed`);
            messageId = msRet!.messageId;
        }

        utils.sleep(1000).then(() => {
            instance.removeMessage(chatid, messageId1)
            instance.removeMessage(chatid, messageId2);
        });
    } else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY || stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_SELL) {
        const messageRet = await instance.sendMessage(chatid, `Creating Limit Order with percentage...`);
        const messageId1 = messageRet!.messageId;

        const value = msg.text.trim();
        const [desiredPercent, orderAmount] = value.split(",")

        const isNegative = desiredPercent.startsWith('-');
        const desiredPercentAbs = isNegative ? desiredPercent.substring(1) : desiredPercent;

        const currentPrice = await utils.getPairInfo(session.addr);
        const desiredPrice = isNegative ? (Number(currentPrice.price) * (1 - parseFloat(desiredPercentAbs) / 100)) : Number(currentPrice.price) * (1 + parseFloat(desiredPercentAbs) / 100);
        
        console.log(`currentPrice => ${currentPrice.price} , desirePrice => ${desiredPrice}`)
        
        let messageId2:any
        if (session.user && session.tokenInfo) {
            if (session.walletBalance < 0.2) {
                const temp = await instance.sendMessage(
                    chatid,
                    `⚠️ Order creation Failed! To create limit orders, you need to have at least 0.2 XRP in your wallet.`
                );
                instance.removeMessage(chatid, messageId1)
                utils.sleep(10000).then(() => {
                    instance.removeMessage(chatid, temp!.messageId);
                });
                return;
            }

            if (!(session.tokenBalance > 0)) {
                const temp = await instance.sendMessage(
                    chatid,
                    `⚠️ Order creation Failed! To create sell limit orders, you need to have some tokens in your wallet.`
                );
                instance.removeMessage(chatid, messageId1)
                utils.sleep(10000).then(() => {
                    instance.removeMessage(chatid, temp!.messageId);
                });
                return;
            }

            const [sequenceNum, txHash ] = await utils.createOffer(
                session.depositWallet, //wallet
                session.tokenInfo.address,  //token addr
                stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY ? "buy" : "sell",  // order type
                desiredPrice, // target amount 
                parseFloat(orderAmount.trim()), // order amount
                session.user.limitOrderExpire // expiration in seconds
            )

            if(sequenceNum && txHash) {
                const msRet = await instance.sendMessage(chatid, `✅ Success`);
                messageId2 = msRet!.messageId;

                const limitOrder = await database.createLimitOrder({
                    userid: user._id,
                    tokenAddr: session.tokenInfo.address,
                    orderType: stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY ? "percent_buy" : "percent_sell",
                    // sequenceNum: Date.now(),
                    sequenceNum: sequenceNum,
                    txHash: txHash,
                    targetPrice: value.split(",")[0].trim().replace('$', ''),
                    orderAmount: value.split(",")[1].trim(),
                    status: 1,
                })

                // start monitoring if order is executed
                
                console.log(`monitoring offers for ${session.user.username}'s token: ${session.tokenInfo.address}...`)
                setInterval(async () => {
                    const orders: any = await database.selectLimitOrders({ userid: session.user._id,  tokenAddr: session.tokenInfo.address})
                    const existingOrders = await utils.getOffers(session.depositWallet);
                    const executedOrders = orders.filter((order: any) => {
                        let flag = true;
                        for (const existingOrder of existingOrders) {
                            if (existingOrder.seq === order.sequenceNum) {
                                flag = false;
                                break;
                            }
                        }
                        return flag
                    });

                    if (executedOrders.length === 0) return;
                    await instance.sendMessage(chatid, `Following orders are executed!\n\n${executedOrders.map((order: any) => `Token: ${order.tokenName}, Type: ${order.orderType}, Target: ${order.targetPrice}, Order Amount: ${order.orderAmount}`).join('\n')}`);
                    
                    for (const order of executedOrders) {
                        await database.updateLimitOrder({sequenceNum : order.sequenceNum});
                    }
                }, 5 * 1000);
                

                const menu: any = await instance.limit_order_add_menu(sessionId);
                const title = `offer created for ${session.tokenInfo.name} !
sequence number : ${sequenceNum}
TxHash : <code>${txHash}</code>`
                await instance.switchMenu(sessionId, stateData.message_id, title, menu.menu);
            } else {
                const msRet = await instance.sendMessage(chatid, `⚠️ Failed`);
                messageId2 = msRet!.messageId;
            }
            
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️Getting user and token information Failed`);
            messageId = msRet!.messageId;
        }

        utils.sleep(1000).then(() => {
            instance.removeMessage(chatid, messageId1)
            instance.removeMessage(chatid, messageId2);
        });
    } 
};
