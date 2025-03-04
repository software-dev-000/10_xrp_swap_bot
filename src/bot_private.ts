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
import { Worker } from 'node:worker_threads';


dotenv.config();

/*

start - welcome
snipe - snipe setting
wallet - manage your bot wallet
*/

const parseCode = async (database: any, session: any, wholeCode: string) => {
    let codes: string[] = wholeCode.split("_");
    console.log(`parsed codes ${codes}`);

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
            `😉 Welcome to XRP Prime Bot. To get started, please enter token address (xxx.yyy format) or firstledger URL of the token (<code>https://firstledger.net/token/xxx/yyy</code> format).`
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

    const limitOrderBuyToken = async (seed: string, tokenInfo:any, orderAmount: string, tokenMint:string) => {
        const wallet = xrpl.Wallet.fromSeed(seed);
        
        const isTrustLineExist = await utils.checkTrustLineExist(wallet.address, tokenMint);
        if (!isTrustLineExist) {
            await utils.createTrustline(wallet, tokenMint, tokenInfo.totalSupply.toString())
        }

        const tempInfo = await utils.getPairInfo(tokenMint);

        let maxTokenAmount = Number(orderAmount) / Number(tempInfo.priceInXrp);
        
        console.log(`buy token amount ===> ${maxTokenAmount}, needed XRP amount ===> ${orderAmount}`) 

        const ret = await utils.buyToken(wallet, tokenMint, maxTokenAmount, Number(orderAmount))

        let messageId2:any
        if (ret.status) {           
            
            try {
                // sending fee
                let taxFee = Number(orderAmount) * Number(process.env.FEE_PERCENT) / 100
                let referFee = 0
                const referralUser: any = await database.selectUser({ chatid: user.referredBy })
                if(referralUser) {
                    referFee = Number(orderAmount) * Number(process.env.REFERRAL_FEE_PERCENT) / 100
                    taxFee -= referFee
                }

                console.log(`Admin Fee: ${taxFee}, Referrer Fee: ${referFee}`)

                if (taxFee > 0) {
                    const taxResult = await utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET as string, taxFee)
                    if (taxResult && referFee > 0) {
                        const refUserWallet = xrpl.Wallet.fromSeed(referralUser.depositWallet);                
                        const referResult = await utils.sendXrpToAnotherWallet(wallet, refUserWallet.address, referFee)                    
                        if(referResult) {
                            let totalEarning = referralUser.referralEarning
                            if(Number.isNaN(totalEarning)) totalEarning = 0;
                            totalEarning += referFee
                            referralUser.referralEarning = totalEarning;
                            database.updateUser(referralUser)
                        }
                    }
                }
            } catch (error) {
                console.log(error)
                return { status: false };
            }
            return { status: true, txHash: ret.txHash };
        } else {
            return { status: false };
        }
    }

    const limitOrderSellToken = async (seed: string, orderAmount: string, tokenMint:string) => {
        const wallet = xrpl.Wallet.fromSeed(seed);
        const tempInfo = await utils.getPairInfo(tokenMint);
        const tokenBalance = await utils.getTokenBalance(wallet.address, tokenMint);
        const sellTokenAmount = tokenBalance * Number(orderAmount) / 100;
        const tempXRPAmount = sellTokenAmount * Number(tempInfo.priceInXrp);
        console.log(`sell token amount ===> ${sellTokenAmount}, get XRP amount ===> ${tempXRPAmount}`) 
        
        const ret = await utils.sellToken(wallet, tokenMint, sellTokenAmount);
        if(orderAmount === '100') {
            await utils.removeTrustline(wallet, tokenMint);
        }

        let messageId2:any
        if (ret.status) {           
            try {
                // sending fee
                let taxFee = tempXRPAmount * Number(process.env.FEE_PERCENT) / 100
                let referFee = 0
                const referralUser: any = await database.selectUser({ chatid: user.referredBy })
                if(referralUser) {
                    referFee = tempXRPAmount * Number(process.env.REFERRAL_FEE_PERCENT) / 100
                    taxFee -= referFee
                }

                console.log(`Admin Fee: ${taxFee}, Referrer Fee: ${referFee}`)

                if (taxFee > 0) {
                    const taxResult = await utils.sendXrpToAnotherWallet(wallet, process.env.XRP_FEE_WALLET as string, taxFee)
                    if (taxResult && referFee > 0) {
                        const refUserWallet = xrpl.Wallet.fromSeed(referralUser.depositWallet);                
                        const referResult = await utils.sendXrpToAnotherWallet(wallet, refUserWallet.address, referFee)                    
                        if(referResult) {
                            let totalEarning = referralUser.referralEarning
                            if(Number.isNaN(totalEarning)) totalEarning = 0;
                            totalEarning += referFee
                            referralUser.referralEarning = totalEarning;
                            database.updateUser(referralUser)
                        }
                    }
                }
                return { status: true, txHash: ret.txHash };
            } catch (error) {
                console.log(error)
                return { status: false} ;
            } 
        } else {
            return { status: false} ;
        }
    }

    const stateData = stateNode.data;

    if (stateNode.state === StateCode.WAIT_SET_BUY_AMOUNT) {
        const value = Number(msg.text.trim());
        if (isNaN(value)) {
            instance.openMessage(
                sessionId, "", 0,
                `⚠️ Sorry, the token amount you entered is invalid. Please try again`
            );
            return;
        }

        console.log(`input amount: ${value}, your balance: ${session.walletBalance}`)
        if(value > session.walletBalance) {
            await instance.sendMessage(chatid, `⚠️ Your XRP balance is smaller than your input amount.`);
            return;
        }
        const messageRet = await instance.sendMessage(sessionId, `Buying ${value} XRP...`);
        const messageId1 = messageRet!.messageId;
        const ret = await botLogic.buyToken(session.depositWallet, session.addr, value, session.tokenInfo);
        let messageId2: any
        if (ret.status) {
            let taxFee = value * Number(process.env.FEE_PERCENT) / 100
            let referFee = 0
            const referralUser: any = await database.selectUser({ chatid: user.referredBy })
            if(referralUser) {
                referFee = value * Number(process.env.REFERRAL_FEE_PERCENT) / 100
                taxFee -= referFee
            }
            console.log(`Admin Fee: ${taxFee}, Referrer Fee: ${referFee}`)
            const userWallet = xrpl.Wallet.fromSeed(session.depositWallet);
            
            // using promise all() for sending transaction in parallel
            // const promises = [];

            // if (taxFee > 0) {
            //     promises.push(utils.sendXrpToAnotherWallet(userWallet, process.env.XRP_FEE_WALLET as string, taxFee));
            // }

            // if (referFee > 0) {
            //     const refUserWallet = xrpl.Wallet.fromSeed(referralUser.depositWallet);
            //     promises.push(utils.sendXrpToAnotherWallet(userWallet, refUserWallet.address, referFee));
            // }

            // const res = await Promise.all(promises);
            // if (referFee > 0 && res[1]) {
            //     let totalEarning = referralUser.referralEarning;
            //     if(Number.isNaN(totalEarning)) totalEarning = 0;
            //     totalEarning += referFee;
            //     referralUser.referralEarning = totalEarning;
            //     database.updateUser(referralUser);
            // }
            if (taxFee > 0) {
                const taxResult = await utils.sendXrpToAnotherWallet(userWallet, process.env.XRP_FEE_WALLET as string, taxFee)
                if (taxResult && referFee > 0) {
                    const refUserWallet = xrpl.Wallet.fromSeed(referralUser.depositWallet);                
                    const referResult = await utils.sendXrpToAnotherWallet(userWallet, refUserWallet.address, referFee)                    
                    if(referResult) {
                        let totalEarning = referralUser.referralEarning;
                        if(Number.isNaN(totalEarning)) totalEarning = 0;
                        totalEarning += referFee;
                        referralUser.referralEarning = totalEarning;
                        database.updateUser(referralUser);
                    }
                }
            }
            console.log(`======= end ======== ${Date.now()}`)
            const msRet = await instance.sendMessage(sessionId, `✅ Success. You have successfully bought ${ret.tokenAmount} tokens for ${ret.XRPAmount} XRP.\nTx Hash: <code>${ret.txHash}</code>`);
            messageId2 = msRet!.messageId;
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            // instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_SET_SELL_PERCENT) {
        const value = Number(msg.text.trim());
        if (isNaN(value) || value > 100) {
            instance.openMessage(
                sessionId, "", 0,
                `⚠️ Sorry, the delay time you entered is invalid. Please try again`
            );
            return;
        }

        const messageRet = await instance.sendMessage(sessionId, `Selling ${value}% token...`);
        const messageId1 = messageRet!.messageId;
        const ret = await botLogic.sellToken(session.depositWallet, session.addr, value);
        let messageId2:any
        if (ret.status) {

            let temmXRPAmount = session.pairInfo.price * session.tokenBalance * value / 100 / session.xrpPrice;
            let taxFee = temmXRPAmount * Number(process.env.FEE_PERCENT) / 100
            let referFee = 0
            const referralUser: any = await database.selectUser({ chatid: user.referredBy })
            if(referralUser) {
                referFee = temmXRPAmount * Number(process.env.REFERRAL_FEE_PERCENT) / 100
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
            const msRet = await instance.sendMessage(sessionId, `✅ Success. You have sold ${ret.tokenAmount} tokens.\nTx Hash: <code>${ret.txHash}</code>`);
            messageId2 = msRet!.messageId;
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            // instance.removeMessage(sessionId, messageId2);
        });

        const menu: any = instance.json_main(sessionId);
        let title: string = await instance.getMainMenuMessage(sessionId);

        await instance.switchMenu(sessionId, stateData.message_id, title, menu.options);
    } else if (stateNode.state === StateCode.WAIT_TOKEN_CHANGE_ADRR) {
        const value = msg.text.trim();
        if (!await utils.isValidTokenAddressOrUrl(value)) {
            instance.openMessage(
                sessionId, "", 0,
                `⚠️ Sorry, the token address you entered is invalid. Please try again`
            );
            return;
        }

        session.addr = utils.validateAddressAndTransform(value);
        console.log(`updated addr => ${session.addr}`)
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
            const msRet = await instance.sendMessage(sessionId, `✅ Success. Your have withdrawn to <code>${value}</code> wallet successfully!`);
            messageId2 = msRet!.messageId;
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Failed`);
            messageId2 = msRet!.messageId;
        }
        utils.sleep(1).then(() => {
            instance.removeMessage(sessionId, messageId1)
            // instance.removeMessage(sessionId, messageId2);
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
            await instance.sendMessage(chatid, `✅ Success. Your have imported <code>${wallet.address}</code> wallet successfully! You will use this wallet from now on.`);
            const menu: any = instance.json_main(sessionId);
            let title: string = await instance.getMainMenuMessage(sessionId);

            await instance.openMenu(sessionId, stateData.message_id, title, menu.options);
        } catch (err: any) {
            await instance.sendMessage(sessionId, "⚠️Failed. Invalid seed");
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
        const title = `📌 Token: ${session.tokenInfo.name}
<code>${session.tokenInfo.address} </code>
Current Price: <code>${session.pairInfo.price}</code>

Limit orders support take-profit and stop-loss.

Add orders based on specified prices or percentage changes.`
        await instance.switchMenu(sessionId, stateData.message_id, title, menu.menu); 

    } else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY || stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_SELL) {
        const value = msg.text.trim();
        let [desiredPrice, orderAmount] = value.split(",")
        desiredPrice = desiredPrice.trim();
        orderAmount = orderAmount.trim();

        // check if desiredPrice is valid
        if (Number(desiredPrice) < 0) {
            await instance.sendMessage(chatid, `⚠️ Desired price must be greater than 0.`);
            return;
        }

        // check if enough XRP in the wallet for buy order
        const userWallet = xrpl.Wallet.fromSeed(session.depositWallet);
        const XRPBalance = await utils.getXrpBalance(userWallet.classicAddress);
        if(stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY && Number(orderAmount) > Number(XRPBalance) ) {
            await instance.sendMessage(chatid, `⚠️ You have to pay ${Number(orderAmount)} XRP for this order, but you only have ${Number(XRPBalance)} XRP.`);
            return;
        }

        // check if percent is valid
        if(stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_SELL && Number(orderAmount) > 100 ) {
            await instance.sendMessage(chatid, `⚠️ Percent cannot be greater than 100.`);
            return;
        }

        // check if current token balance is not 0
        if(stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_SELL) {
            const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
            const tokenBalance = await utils.getTokenBalance(wallet.address, session.addr);
            if(Number(tokenBalance) === 0) {
                await instance.sendMessage(chatid, `⚠️ You don't have any token to sell.`);
                return;
            } 
        }

        const messageRet = await instance.sendMessage(chatid, `Creating Limit Order with a specific price...`);
        const messageId1 = messageRet!.messageId;
        
        let messageId2:any
        if (session.user && session.tokenInfo) {
            console.log(`desiredPrice => ${desiredPrice}, orderAmount => ${orderAmount}`)


            const tokenInfo = {...session.tokenInfo};
            const tokenMint = session.addr;
            const depositWallet = session.depositWallet;
            
            let isDBCreated = false;
            const limitOrder = await database.createLimitOrder({
                userid: user._id,
                tokenAddr: session.tokenInfo.address,
                tokenName: session.tokenInfo.name,
                depositWallet: session.depositWallet,
                orderType: stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY ? "price_buy" : "price_sell",
                // sequenceNum: Date.now(),
                intervalId: 0,
                txHash: "",
                targetPrice: value.split(",")[0].trim().replace('$', ''),
                orderAmount: value.split(",")[1].trim(),
                status: 1,
            })

            await instance.sendMessage(chatid, `✅ Success. Your order has been created!\nIt will be executed when the token price meets your need. `);
            
            let intervalId = setInterval(async () => {
                if(!isDBCreated) {
                    console.log(`[${user.username}] : setting interval id for limit order${limitOrder._id}`)
                    await database.setIntervalId({_id : limitOrder._id, intervalId: intervalId});
                    isDBCreated = true;
                }
                const tempInfo = await utils.getPairInfo(tokenMint)
                console.log(`[${user.username}:${tempInfo.pair.split("/")[0].trim()}] Current Price => ${tempInfo.price}, Target Price => ${desiredPrice}`)

                if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_BUY && Number(tempInfo.price) <= Number(desiredPrice)) {
                    console.log(`[${user.username}] : terminated monitoring offer for ${tokenInfo.name}`)
                    clearInterval(intervalId);
                    const res = await limitOrderBuyToken(depositWallet, tokenInfo, orderAmount, tokenMint);
                    if (res.status) {
                        try {
                            await database.updateLimitOrder({_id : limitOrder._id, txHash: res.txHash});
                            await instance.sendMessage(chatid, `✅ Success. Your order has been executed!\n\nToken: ${tokenInfo.name}, Type: price_sell, Target Price: ${desiredPrice}, Bought Price: ${tempInfo.price}, Order Amount: ${orderAmount} XRP\nTxHash: <code>${res.txHash}</code>`);
                        } catch (error) {
                            console.log(error);
                        } 
                    } else {
                        const msRet = await instance.sendMessage(chatid, `⚠️ Failed`);
                        messageId2 = msRet!.messageId;
                    }

                }
                else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PRICE_SELL && Number(tempInfo.price) >= Number(desiredPrice)) {
                    console.log(`[${user.username}] : terminated monitoring offer for ${tokenInfo.name}`)
                    clearInterval(intervalId);
                    const res = await limitOrderSellToken(depositWallet, orderAmount, tokenMint);
                    if(res.status) {
                        // update database
                        try {
                            await database.updateLimitOrder({_id : limitOrder._id, txHash: res.txHash});
                            await instance.sendMessage(chatid, `✅ Success. Your order has been executed!\n\nToken: ${tokenInfo.name}, Type: price_sell, Target Price: ${desiredPrice}, Sold Price: ${tempInfo.price}, Order Amount: ${orderAmount} %\nTxHash: <code>${res.txHash}</code>`);
                        } catch (error) {
                            console.log(error);
                        }
                        
                    } else {
                        const msRet = await instance.sendMessage(chatid, `⚠️ Failed`);
                        messageId2 = msRet!.messageId;
                    }
                }
            }, 5000);

            
        } else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Getting user and token information Failed`);
            messageId = msRet!.messageId;
        }

        utils.sleep(1).then(() => {
            instance.removeMessage(chatid, messageId1)
            // instance.removeMessage(chatid, messageId2);
        });
    } else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY || stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_SELL) {
        const value = msg.text.trim();
        let [desiredPercent, orderAmount] = value.split(",")
        desiredPercent = desiredPercent.trim();
        orderAmount = orderAmount.trim();

        const isNegative = desiredPercent.startsWith('-');
        const desiredPercentAbs = isNegative ? desiredPercent.substring(1) : desiredPercent;

        const currentPrice = await utils.getPairInfo(session.addr);
        const desiredPrice = isNegative ? (Number(currentPrice.price) * (1 - parseFloat(desiredPercentAbs) / 100)) : Number(currentPrice.price) * (1 + parseFloat(desiredPercentAbs) / 100);
        
        // check if desiredPrice is valid
        if (Number(desiredPrice) < 0) {
            await instance.sendMessage(chatid, `⚠️ Desired price must be greater than 0.`);
            return;
        }

        // check if enough XRP in the wallet for buy order
        const userWallet = xrpl.Wallet.fromSeed(session.depositWallet);
        const XRPBalance = await utils.getXrpBalance(userWallet.classicAddress);
        if(stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY && Number(orderAmount) > Number(XRPBalance)) {
            await instance.sendMessage(chatid, `⚠️ You have to pay ${Number(desiredPrice)} XRP for this order, but you only have ${Number(XRPBalance)} XRP.`);
            return;
        }

        // check if percent is valid
        if(stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_SELL && Number(orderAmount) > 100 ) {
            await instance.sendMessage(chatid, `⚠️ Percent cannot be greater than 100.`);
            return;
        }

        // check if current token balance is not 0
        if(stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_SELL) {
            const wallet = xrpl.Wallet.fromSeed(session.depositWallet);
            const tokenBalance = await utils.getTokenBalance(wallet.address, session.addr);
            if(Number(tokenBalance) === 0) {
                await instance.sendMessage(chatid, `⚠️ You don't have any token to sell.`);
                return;
            } 
        }



        const messageRet = await instance.sendMessage(chatid, `Creating Limit Order with percentage...`);
        const messageId1 = messageRet!.messageId;

        let messageId2:any
        if (session.user && session.tokenInfo) {
            console.log(`desiredPrice => ${desiredPrice}, orderAmount => ${orderAmount}`)

            const tokenInfo = {...session.tokenInfo};
            const tokenMint = session.addr;
            const depositWallet = session.depositWallet;
            
            let isDBCreated = false;
            const limitOrder = await database.createLimitOrder({
                userid: user._id,
                tokenAddr: session.tokenInfo.address,
                tokenName: session.tokenInfo.name,
                depositWallet: session.depositWallet,
                orderType: stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY ? "percent_buy" : "percent_sell",
                // sequenceNum: Date.now(),
                intervalId: 0,
                txHash: "",
                targetPrice: value.split(",")[0].trim().replace('$', ''),
                orderAmount: value.split(",")[1].trim(),
                status: 1,
            })

            await instance.sendMessage(chatid, `✅ Success. Your order has been created!\nIt will be executed when the token price meets your need. `);

            let intervalId = setInterval(async () => {
                if(!isDBCreated) {
                    console.log(`[${user.username}] : setting interval id for limit order ${limitOrder._id}`)
                    await database.setIntervalId({_id : limitOrder._id, intervalId: intervalId});
                    isDBCreated = true;
                }
                const tempInfo = await utils.getPairInfo(tokenMint)
                console.log(`[${user.username}:${tempInfo.pair.split("/")[0].trim()}] Current Price => ${tempInfo.price}, Target Price => ${desiredPrice}`)

                if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_BUY && Number(tempInfo.price) <= Number(desiredPrice)) {
                    console.log(`[${user.username}] : terminated monitoring offer for ${tokenInfo.name}`)
                    clearInterval(intervalId);
                    const res = await limitOrderBuyToken(depositWallet, tokenInfo, orderAmount, tokenMint);
                    if (res) {
                        await database.updateLimitOrder({_id : limitOrder._id, txHash: res.txHash});
                        await instance.sendMessage(chatid, `✅ Success. Your order has been executed!\n\nToken: ${tokenInfo.name}, Type: price_sell, Target Price: ${desiredPrice}, Bought Price: ${tempInfo.price}, Order Amount: ${orderAmount} XRP\nTxHash: <code>${res.txHash}</code>`);

                    } else {
                        const msRet = await instance.sendMessage(chatid, `⚠️ Failed`);
                        messageId2 = msRet!.messageId;
                    }

                }
                else if (stateNode.state === StateCode.WAIT_LIMIT_ORDER_PERCENT_SELL && Number(tempInfo.price) >= Number(desiredPrice)) {
                    console.log(`[${user.username}] : terminated monitoring offer for ${tokenInfo.name}`)
                    clearInterval(intervalId);
                    const res = await limitOrderSellToken(depositWallet, orderAmount, tokenMint);
                    if(res.status) {
                        // update database
                        await database.updateLimitOrder({_id : limitOrder._id, txHash: res.txHash});
                        await instance.sendMessage(chatid, `✅ Success. Your order has been executed!\n\nToken: ${tokenInfo.name}, Type: price_sell, Target Price: ${desiredPrice}, Bought Price: ${tempInfo.price}, Order Amount: ${orderAmount} %\nTxHash: <code>${res.txHash}</code>`);
                        
                        clearInterval(intervalId);
                    } else {
                        const msRet = await instance.sendMessage(chatid, `⚠️ Failed`);
                        messageId2 = msRet!.messageId;
                    }
                }
            }, 5000);
        }
            
        else {
            const msRet = await instance.sendMessage(sessionId, `⚠️ Getting user and token information Failed`);
            messageId = msRet!.messageId;
        }

        utils.sleep(1).then(() => {
            instance.removeMessage(chatid, messageId1)
            // instance.removeMessage(chatid, messageId2);
        });
        
    }

};
