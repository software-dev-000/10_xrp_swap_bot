import axios from 'axios';
import * as dotenv from 'dotenv';
import * as xrpl from 'xrpl';
import * as instance from './bot';
import * as afx from './global';
import { XRPL_RESERVE_AMOUNT } from './constants';
import * as database from './db';

dotenv.config()

let reserveBaseXRP = 0
let reserveIncXRP = 0

const ReferralCodeBase = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const getReservedVal = async () => {
    console.log("[BOT STARTING] Getting Reserved Value...")
    await afx.client.connect()
    console.log("[BOT STARTING] Connected to XRP Ledger.")
    const serverInfo: any = await afx.client.request({
        command: 'server_info'
    });
    reserveBaseXRP = serverInfo.result.info.validated_ledger.reserve_base_xrp;
    reserveIncXRP = serverInfo.result.info.validated_ledger.reserve_inc_xrp;
    console.log("[BOT LAUNCHED] Got Reserved Value Successfully!", reserveBaseXRP, reserveIncXRP)
}

export const getSOLPrice = async (): Promise<number> => {
    try {
        const { solana } = await fetchAPI("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", "GET")
        return solana.usd as number
    } catch (error) {
        await sleep(200)
        return getSOLPrice()
    }
}

export const getXrpPrice = async (): Promise<number> => {
    try {
        const { ripple } = await fetchAPI("https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd", "GET")
        return ripple.usd as number
    } catch (error) {
        await sleep(200)
        return getXrpPrice()
    }
}

const dexscreenerTokenPairUrl: string = "https://api.dexscreener.com/latest/dex/tokens/"
export interface PairInfo {
    dex: string;
    pair: string;
    price: string;
    priceInXrp: string;
    lp: string;
    mc: string;
}

export const getPairInfo = async (mint: string) => {
    let result: PairInfo = {
        dex: "",
        pair: "",
        price: "",
        priceInXrp: "",
        lp: "",
        mc: ""
    }

    if (mint == undefined || mint == null || mint == "") {
        return result;
    }

    const data = await fetchAPI(dexscreenerTokenPairUrl + mint, "GET")
    if (data && data.pairs) {
        for (let pair of data.pairs) {
            if (pair.chainId == "xrpl" && pair.dexId == "xrpl") {
                result.dex = pair.dexId
                result.pair = pair.baseToken.symbol + " / " + pair.quoteToken.symbol
                result.price = pair.priceUsd
                result.priceInXrp = pair.priceNative
                result.lp = roundBigUnit(pair.liquidity.usd, 2)
                result.mc = roundBigUnit(pair.fdv, 2)
                return result
            }
        }
    }
    return result
}

function transformUrlToTokenAddr(url: string) {
    // Check if the URL matches the expected format
    const match = url.match(/\/token\/([^/]+)\/([^/]+)/);
    if (match) {
        const tokenId = match[2];
        const walletId = match[1];
        return `${tokenId}.${walletId}`;
    }
    return null; // Return null if the URL doesn't match the expected format
}

export const validateAddressAndTransform = (input: string) => {
    // Regex to check if the input is in the desired format
    const validFormatRegex = /^([a-fA-F0-9]+)\.([a-zA-Z0-9]+)$/;
    console.log(input)
    // If the input matches the desired format, return it as is
    if (validFormatRegex.test(input)) {
        return input;
    }

    const validFormatRegex1 = /^([A-Z]+)\.([a-zA-Z0-9]+)$/;
    if (validFormatRegex1.test(input)) {
        const temps = input.split(".");
        if (temps[0].length == 3)
            return input;
    }

    // Otherwise, try to transform the input if it's a valid URL
    const transformed = transformUrlToTokenAddr(input);
    return transformed || "Invalid"; // Return the transformed value or an error message
}

export const isValidTokenAddressOrUrl = async (inputStr: string) => {
    try {
        const transformed = validateAddressAndTransform(inputStr)
        if (transformed == "Invalid") {
            return false;
        }
        const tokenInfo = await getTokenInfo(transformed)
        if (tokenInfo) return true
        return false
    } catch (error) {
        return false
    }
}

export const getTokenInfo = async (address: string) => {
    if (address == undefined || address == null || address == "") {
        return {
            address: "",
            id: "",
            name: "",
            symbol: "",
            totalSupply: 0,
            decimals: 0,
            description: null,
            iconUrl: null
        }
    }

    try {
        const [_token, _address] = address.split('.')

        const response = await afx.client.request({
            command: 'account_lines',
            account: _address,
            ledger_index: 'validated'
        })

        const tokenInfo = response.result.lines.find(line => line.currency === _token)
        if (tokenInfo) {
            return {
                address: address,
                id: address,
                name: getStringFromCurrencyCode(tokenInfo.currency),
                symbol: getStringFromCurrencyCode(tokenInfo.currency) != "" ? getStringFromCurrencyCode(tokenInfo.currency) : tokenInfo.currency,
                totalSupply: await getTokenObligations(_address, tokenInfo.currency),
                decimals: 0,
                description: null,
                iconUrl: null
            }
        } else {
            throw new Error('Token not found.')
        }
    } catch (error) {
        console.log('getTokenInfo->error:', error)
    }
}

export const getTokenObligations = async (address: string, currencyCode: string) => {
    const response: any = await afx.client.request({
        command: 'gateway_balances',
        account: address,
        ledger_index: 'validated',
        "hotwallet": [],
        "strict": true,
    })

    if (response.result.obligations && response.result.obligations[currencyCode]) return Number(response.result.obligations[currencyCode])
    return 0
}

const getStringFromCurrencyCode = (address: string): string => {
    let rlt = "";

    for (let i = 0; i < address.length; i += 2) {
        let hexPair = address.substring(i, i + 2);
        let decimalValue = parseInt(hexPair, 16);
        if (decimalValue === 0) continue
        rlt += String.fromCharCode(decimalValue);
    }

    if (rlt.length === 0) return address
    return rlt
}

export const generateNewWallet = () => {
    const keypair = xrpl.Wallet.generate();
    const address = keypair.address;
    const seed = keypair.seed!;
    return { address, seed }
}

export const getXrpBalance = async (address: string): Promise<number> => {
    try {
        const response: any = await afx.client.request({
            command: 'account_info',
            account: address,
            ledger_index: 'validated'
        });
        const ownerCount = response.result.account_data.OwnerCount;
        const reservedBalance = reserveBaseXRP + (reserveIncXRP * ownerCount);

        const rlt = await afx.client.getXrpBalance(address)

        return rlt - reservedBalance
    } catch (error) {
        return -XRPL_RESERVE_AMOUNT
    }
}

export const getTokenBalance = async (address: string, token: string) => {
    if (token == undefined || token == null || token == "")
        return 0;

    const [_token, _address] = token.split('.')

    try {
        const response = await afx.client.request({
            command: 'account_lines',
            account: address,
            ledger_index: 'validated'
        })

        const tokenInfo = response.result.lines.find(line => line.account === _address)

        if (tokenInfo) return Number(tokenInfo.balance)
        return 0
    } catch (error: any) {
        if (error.data.error_code === 19) return 0
        throw new Error(error.error_message)
    }

}

export const sendXrpToAnotherWallet = async (from: xrpl.Wallet, to: string, amount: number) => {
    try {
        const prepared = await afx.client.autofill({
            "TransactionType": "Payment",
            "Account": from.address,
            "Amount": (Math.ceil(amount * 1000000)).toString(),
            "Destination": to,
            "DestinationTag": 111
        })
        console.log(`Pending transaction for sending ${amount} from ${from.address} to ${to}`)
        const signed = from.sign(prepared)
        const tx: any = await afx.client.submitAndWait(signed.tx_blob)
        console.log(`Sent transaction for sending ${amount} from ${from.address} to ${to} ===> `, tx.result.meta.TransactionResult)
        if (tx.result.meta.TransactionResult == "tesSUCCESS")
            return true;
        else
            return false;
    } catch (error) {
        console.log(`Failed in sending ${amount} XRP from ${from.address} to ${to}`)
        return false
    }
}

export const getSendXrpTrx = async (from: xrpl.Wallet, to: string, amount: number) => {
    try {
        const prepared = await afx.client.autofill({
            "TransactionType": "Payment",
            "Account": from.address,
            "Amount": (Math.ceil(amount * 1000000)).toString(),
            "Destination": to,
        })
        const signed = from.sign(prepared)
        return afx.client.submitAndWait(signed.tx_blob)
    } catch (error) {
        throw error
    }
}

export const checkTrustLineExist = async (account: string, addr: string) => {
    const [currency, issuer] = addr.split(".");
    const response = await afx.client.request({
        command: 'account_lines',
        account: account
    })

    const trustLines = response.result.lines;
    const trustLineExists = trustLines.some(line =>
        line.currency === currency && line.account === issuer
    );
    return trustLineExists
}

export const estimateTokenAmountToBuy = async (xrpAmount: number, addr: string) => {
    // Connect to the XRP Ledger
    if (!afx.client.isConnected())
        await afx.client.connect();

    const [tokenCurrency, tokenIssuer] = addr.split('.');
    // Define the token details

    // Retrieve the order book for the XRP/token pair
    const response = await afx.client.request({
        command: 'book_offers',
        taker_gets: {
            currency: 'XRP'
        },
        taker_pays: {
            currency: tokenCurrency,
            issuer: tokenIssuer
        }
    });

    // console.log(response)

    // Calculate the token amount
    let remainingXrp = xrpAmount;
    let tokenAmount = 0;

    for (const offer of response.result.offers) {
        const offer_dump: any = offer
        const offerXrpAmount = parseFloat(offer_dump.TakerGets) / 1000000; // Convert drops to XRP
        const offerTokenAmount = parseFloat(offer_dump.TakerPays.value)

        if (remainingXrp >= offerXrpAmount) {
            tokenAmount += offerTokenAmount;
            remainingXrp -= offerXrpAmount;
        } else {
            tokenAmount += (remainingXrp / offerXrpAmount) * offerTokenAmount;
            break;
        }
    }
    console.log(`Estimated token amount: ${tokenAmount}`);

    // Disconnect from the XRP Ledger
    return tokenAmount
}

export const estimateXrpAmountToSell = async (tokenAmount: number, addr: string) => {
    // Connect to the XRP Ledger
    if (!afx.client.isConnected())
        await afx.client.connect();

    const [tokenCurrency, tokenIssuer] = addr.split('.');
    // Define the token details

    // Retrieve the order book for the XRP/token pair
    const response = await afx.client.request({
        command: 'book_offers',
        taker_gets: {
            currency: tokenCurrency,
            issuer: tokenIssuer
        },
        taker_pays: {
            currency: 'XRP'
        }
    });

    // Calculate the xrp amount
    let remainingTokenAmount = tokenAmount;
    let xrpAmount = 0;

    for (const offer of response.result.offers) {
        const offer_dump: any = offer
        const offerTokenAmount = parseFloat(offer_dump.TakerGets.value)
        const offerXrpAmount = parseFloat(offer_dump.TakerPays) / 1000000;

        if (remainingTokenAmount >= offerTokenAmount) {
            xrpAmount += offerXrpAmount;
            remainingTokenAmount -= offerTokenAmount;
        } else {
            xrpAmount += (remainingTokenAmount / offerTokenAmount) * offerXrpAmount;
            break;
        }
    }
    console.log(`Estimated xrp amount: ${xrpAmount}`);

    // Disconnect from the XRP Ledger
    return xrpAmount
}

export const createTrustline = async (
    wallet: xrpl.Wallet,
    addr: string,
    limit: string
): Promise<any | null> => {
    const [currency, issuer] = addr.split(".");
    try {
        console.log(`currency: ${currency}, issuer: ${issuer}, limit: ${limit}`);

        // TrustSet transaction details
        const trustSetTx: xrpl.SubmittableTransaction = {
            TransactionType: "TrustSet",
            Account: wallet.classicAddress,
            LimitAmount: {
                currency: currency,
                issuer: issuer,
                value: limit, // Trustline limit amount
            },
        };

        // Autofill, sign, and submit the transaction
        const prepared = await afx.client.autofill(trustSetTx);
        const signed = wallet.sign(prepared);
        const result: any = await afx.client.submitAndWait(signed.tx_blob);

        // await client.disconnect();
        // Check the transaction result
        if (result.result.meta?.TransactionResult === "tesSUCCESS") {
            console.log("Trustline created successfully!");
            return result.result;
        } else {
            console.error("Failed to create trustline:", result.result.meta?.TransactionResult);
            return null;
        }
    } catch (error) {
        console.error("Error creating trustline:", error);
        return null;
    }
};

export const removeTrustline = async (
    wallet: xrpl.Wallet,
    addr: string
): Promise<any | null> => {
    const [currency, issuer] = addr.split(".");
    try {
        console.log(`currency: ${currency}, issuer: ${issuer} removing trustline...`);

        // TrustSet transaction details
        const trustSetTx: xrpl.SubmittableTransaction = {
            TransactionType: "TrustSet",
            Account: wallet.classicAddress,
            LimitAmount: {
                currency: currency,
                issuer: issuer,
                value: "0", // Trustline limit amount
            },
            Flags: xrpl.TrustSetFlags.tfSetNoRipple | xrpl.TrustSetFlags.tfClearFreeze
        };

        // Autofill, sign, and submit the transaction
        const prepared = await afx.client.autofill(trustSetTx);
        const signed = wallet.sign(prepared);
        const result: any = await afx.client.submitAndWait(signed.tx_blob);

        // await client.disconnect();
        // Check the transaction result
        if (result.result.meta?.TransactionResult === "tesSUCCESS") {
            console.log("Trustline removed successfully!");
            return result.result;
        } else {
            console.error("Failed to remove trustline:", result.result.meta?.TransactionResult);
            return null;
        }
    } catch (error) {
        console.error("Error removing trustline:", error);
        return null;
    }
};

export const buyToken = async (
    wallet: xrpl.Wallet,
    addr: string,
    tokenAmount: number,
    sendMaxXRP: number,
    deliverMinToken?: string
): Promise<any | null> => {
    const [currency, issuer] = addr.split('.');
    try {
        console.log(`Pending transactions for buying token with ${sendMaxXRP} xrp from wallet ${wallet.address}`)
        const tx: any = await afx.client.submitAndWait({
            "TransactionType": "Payment",
            "Account": wallet.classicAddress,
            "Amount": {
                "currency": currency,
                "issuer": issuer,
                "value": tokenAmount > 10 ** 6 ? tokenAmount.toFixed(0) : tokenAmount.toFixed(6)
            },
            "Destination": wallet.classicAddress,
            "SendMax": xrpl.xrpToDrops((sendMaxXRP).toFixed(6)),
            "Flags": 131072
        }, { autofill: true, wallet: wallet })
        console.log(`Sent transaction for buying token with ${sendMaxXRP} XRP from wallet ${wallet.address} ===> `, tx.result.meta.TransactionResult)

        if (tx.result.meta?.TransactionResult == "tesSUCCESS")
            return {status: true, tokenAmount: tokenAmount, XRPAmount: sendMaxXRP, txHash: tx.result.hash};
        else
            return {status: false};
    } catch (error) {
        console.log(`Failed to buy token with ${sendMaxXRP} XRP from wallet ${wallet.address}`)
        console.log(error);
        return {status: false};
    }
};

export const sellToken = async (
    wallet: xrpl.Wallet,
    addr: string,
    tokenAmount: number,
    isRemoveTrustline?: boolean
): Promise<any | null> => {
    const [currency, issuer] = addr.split('.');
    try {
        console.log(`Pending transactions for selling ${tokenAmount} tokens from wallet ${wallet.address}`)
        const tx: any = await afx.client.submitAndWait({
            "TransactionType": "Payment",
            "Account": wallet.classicAddress,
            "Amount": "1000000000",
            "Destination": wallet.classicAddress,
            "SendMax": {
                "currency": currency,
                "issuer": issuer,
                "value": tokenAmount > 10 ** 8 ? tokenAmount.toFixed(0) : tokenAmount.toFixed(6)
            },
            "Flags": 0x00020000
        }, { autofill: true, wallet: wallet })
        console.log(`Sent transaction for sell ${tokenAmount} tokens from wallet ${wallet.address} ===> `, tx.result.meta.TransactionResult)
        if(isRemoveTrustline) {
            try {
                await removeTrustline(wallet, addr)
            } catch (error) {   
                console.log(error)
            }
        }
        if (tx.result.meta?.TransactionResult == "tesSUCCESS")
            return {status: true, tokenAmount: tokenAmount, txHash: tx.result.hash};
        else
            return {status: false};
    } catch (error) {
        console.log(`Failed to sell ${tokenAmount} tokens from wallet ${wallet.address}`)
        console.log(error)
            return {status: false};
    }
};

export const createOffer = async (
    seed: string,
    addr: string,
    orderType: string,
    desiredPrice: number,
    orderAmount: number,
    expiry: number
): Promise<any | null> => {
    const [currency, issuer] = addr.split('.');
    const XRPPrice = await getXrpPrice();
    const payAmount = desiredPrice * orderAmount / XRPPrice;
    const wallet = xrpl.Wallet.fromSeed(seed)
    let offer: any;

    console.log('[STARTING CREATING LIMIT ORDER...]')
    if (orderType == 'buy') {
        console.log(`You will buy ${orderAmount.toFixed(6).toString()} Token and pay ${payAmount.toString()} XRP`)

        offer = {
            TransactionType: 'OfferCreate',
            Account: wallet.classicAddress,
            TakerPays: {
                currency: currency,
                issuer: issuer,
                value: orderAmount > 10 ** 6 ? orderAmount.toFixed(0).toString() : orderAmount.toFixed(6).toString(),
            },
            // TakerGets: {
            //     currency: 'USD', // Currency code to receive
            //     issuer: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq',  // USD issuer (GateHub)
            //     value: payAmount.toFixed(6).toString(), // Amount to receive
            // },
            TakerGets: xrpl.xrpToDrops(payAmount.toFixed(6)),
            Expiration: Math.floor(Date.now() / 1000) + expiry - 946684800
        }

    } else if (orderType == 'sell') {
        console.log(`You will sell ${orderAmount.toFixed(6).toString()} Token and get ${payAmount.toString()} XRP`)

        offer = {
            TransactionType: 'OfferCreate',
            Account: wallet.classicAddress,
            // TakerPays: {
            //     currency: 'USD', // Currency code to receive
            //     issuer: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq',  // USD issuer (GateHub)
            //     value: payAmount.toFixed(6).toString(), // Amount to receive
            // },
            TakerPays: xrpl.xrpToDrops(payAmount.toFixed(6)),
            TakerGets: {
                currency: currency,
                issuer: issuer,
                value: orderAmount > 10 ** 6 ? orderAmount.toFixed(0).toString() : orderAmount.toFixed(6).toString(),
            },
            Expiration: Math.floor(Date.now() / 1000) + expiry - 946684800
        }
    }

    try {
        const tx: any = await afx.client.submitAndWait(offer, { autofill: true, wallet: wallet })
        // console.log(`transaction result => ${JSON.stringify(tx, null, 2)}`)

        if (tx.result.meta?.TransactionResult == "tesSUCCESS") {
            console.log(`Limit order created successfully!`)

            return [tx.result.tx_json.Sequence, tx.result.hash];
        }
        else {
            console.log(`Limit order failed!`)
            // console.log(`transaction result => ${JSON.stringify(tx, null, 2)}`)
            return [null, null];
        }
    } catch (error) {
        console.log(`Limit order failed!`)
        console.log(error)
        return [null, null];
    } finally {
        console.log('[CREATING LIMIT ORDER ENDED]')
    }
}

export const cancelOffer = async (
    seed: string,
    offerSeq: number
): Promise<any | null> => {
    try {
        const wallet = xrpl.Wallet.fromSeed(seed)
        const tx: any = await afx.client.submitAndWait({
            "TransactionType": "OfferCancel",
            "Account": wallet.classicAddress,
            "OfferSequence": offerSeq
        }, { autofill: true, wallet: wallet })
        console.log(`[ORDER CANCELLATION STARTED...]`)
        console.log(`order ${offerSeq} cancellation tx txHash => ${tx.result.hash}, result => ${tx.result.meta.TransactionResult}`)

        if (tx.result.meta?.TransactionResult == "tesSUCCESS") {
            console.log(`order ${offerSeq} cancelled successfully!`)
            return true;
        }
        else {
            console.log(`order ${offerSeq} cancellation failed!`)
            return false;
        }
    } catch (error) {
        console.log(`order ${offerSeq} cancellation failed!`)
        console.log(error)
        return false;
    } finally {
        console.log('[ORDER CANCELLATION ENDED]')
    }
}

export const getOffers = async (
    seed: string,
): Promise<any | null> => {
    try {
        const wallet = xrpl.Wallet.fromSeed(seed);
        const tx: any = await afx.client.request({
            command: 'account_offers',
            account: wallet.classicAddress,
            ledger_index: 'validated'
        })
        return tx.result.offers
    } catch (error) {
        console.log(`Failed to check offer from wallet ${xrpl.Wallet.fromSeed(seed).classicAddress}`)
        console.log(error)
        return false;
    }
}



export const sleep = (ms: number) => {

    return new Promise(resolve => setTimeout(resolve, ms));
}

export const fetchAPI = async (url: string, method: 'GET' | 'POST', data: Record<string, any> = {}): Promise<any | null> => {
    return new Promise(resolve => {
        if (method === "POST") {
            axios.post(url, data).then(response => {
                let json = response.data;
                resolve(json);
            }).catch(error => {
                // console.error('[fetchAPI]', error)
                resolve(null);
            });
        } else {
            axios.get(url).then(response => {
                let json = response.data;
                resolve(json);
            }).catch(error => {
                // console.error('fetchAPI', error);
                resolve(null);
            });
        }
    });
};

export const roundDecimal = (number: number, digits: number = 5) => {
    return number.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export const roundDecimalWithUnit = (number: number, digits: number = 5, unit: string = '') => {
    if (!number) {
        return "0 " + unit
    }
    return number.toLocaleString('en-US', { maximumFractionDigits: digits }) + unit;
}

export const sRoundDecimal = (number: number, digits: number) => {

    let result = roundDecimal(number, digits)
    return number > 0 ? `+${result}` : result
}

export const sRoundDecimalWithUnitAndNull = (number: number | null, digits: number, unit: string) => {

    if (!number) {
        return 'None'
    }

    if (number === 0) {
        return `0${unit}`
    }

    let result = roundDecimal(number, digits)
    return number > 0 ? `+${result}${unit}` : `${result}${unit}`
}

export const roundSolUnit = (number: number, digits: number = 5) => {

    if (Math.abs(number) >= 0.00001 || number === 0) {
        return `${roundDecimal(number, digits)} SOL`
    }

    number *= 1000000000

    return `${roundDecimal(number, digits)} lamports`
}

export const roundBigUnit = (number: number, digits: number = 5) => {

    let unitNum = 0
    const unitName = ['', 'K', 'M', 'B']
    while (number >= 1000) {

        unitNum++
        number /= 1000

        if (unitNum > 2) {
            break
        }
    }

    return `${roundDecimal(number, digits)} ${unitName[unitNum]}`
}


export function objectDeepCopy(obj: any, keysToExclude: string[] = []): any {
    if (typeof obj !== 'object' || obj === null) {
        return obj; // Return non-objects as is
    }

    const copiedObject: Record<string, any> = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && !keysToExclude.includes(key)) {
            copiedObject[key] = obj[key];
        }
    }

    return copiedObject;
}

export const shortenAddress = (address: string, length: number = 6) => {
    if (address.length < 2 + 2 * length) {
        return address; // Not long enough to shorten
    }

    const start = address.substring(0, length + 2);
    const end = address.substring(address.length - length);

    return start + "..." + end;
}

export const shortenString = (str: string, length: number = 8) => {

    if (length < 3) {
        length = 3
    }

    if (!str) {
        return "undefined"
    }

    if (str.length < length) {
        return str; // Not long enough to shorten
    }

    const temp = str.substring(0, length - 3) + '...';

    return temp;
}

export function encodeChatId(chatId: string) {
    const baseLength = ReferralCodeBase.length;

    let temp = Number(chatId)
    let encoded = '';
    while (temp > 0) {
        const remainder = temp % baseLength;
        encoded = ReferralCodeBase[remainder] + encoded;
        temp = Math.floor(temp / baseLength);
    }

    // Pad with zeros to make it 5 characters
    return encoded.padStart(5, '0');
}

export function decodeChatId(encoded: string) {
    const baseLength = ReferralCodeBase.length;

    let decoded = 0;
    const reversed = encoded.split('').reverse().join('');

    for (let i = 0; i < reversed.length; i++) {
        const char = reversed[i];
        const charValue = ReferralCodeBase.indexOf(char);
        decoded += charValue * Math.pow(baseLength, i);
    }

    return decoded.toString();
}
