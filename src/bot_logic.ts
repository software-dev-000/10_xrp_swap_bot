// import * as bot from './bot';
import * as database from './db';
import * as xrpl from 'xrpl';
// import * as fastSwap from './fast_swap';
import * as afx from './global';
// import * as jitoBundler from './jito_bundler';
import * as constants from './constants';
import * as utils from './utils';
import { writeFile } from 'fs';

// const jito_bundler = new jitoBundler.JitoBundler()

// const LookUpTableMap = new Map()

// let solPrice = 0

export const buyToken = async (seed: string, addr: string, buyAmount: number, _tokenInfo: any = null) => {
    const wallet = xrpl.Wallet.fromSeed(seed);
    const isTrustLineExist = await utils.checkTrustLineExist(wallet.address, addr);
    let tokenInfo = _tokenInfo
    if (!tokenInfo) {
        tokenInfo = await utils.getTokenInfo(addr);
    }
    console.log(wallet.address, "TrustLineExist:", isTrustLineExist)
    if (!isTrustLineExist) {
        await utils.createTrustline(wallet, addr, tokenInfo.totalSupply.toString())
    }
    let maxtokenAmount = await utils.estimateTokenAmountToBuy(buyAmount, addr);
    if (maxtokenAmount == 0) {
        maxtokenAmount = buyAmount / Number((await utils.getPairInfo(addr)).priceInXrp)
    }
    console.log("Restimated amount:", maxtokenAmount)
    return await utils.buyToken(wallet, addr, maxtokenAmount, buyAmount)
}

export const sellToken = async (seed: string, addr: string, sellPercent: number) => {
    const wallet = xrpl.Wallet.fromSeed(seed);
    const tokenBalance = await utils.getTokenBalance(wallet.address, addr);
    let sellTokenAmount = tokenBalance * sellPercent / 100;
    return await utils.sellToken(wallet, addr, sellTokenAmount)
}

export const withdraw = async (chatid: string, value: string) => {
    const user: any = await database.selectUser({ chatid })
    const depositWallet = xrpl.Wallet.fromSeed(user.depositWallet);
    const totalBalance = await utils.getXrpBalance(depositWallet.address);
    const transferBalance = totalBalance - 0.00005;
    return await utils.sendXrpToAnotherWallet(depositWallet, value, transferBalance);
}

export const saveWalletSeedAsFile = async (seed: string) => {
    const wallet = xrpl.Wallet.fromSeed(seed);
    writeFile(`./wallets/${wallet.address}.txt`, seed, (err) => {
        if (err) {
            console.error('Error writing to file:', err);
            return;
        }
        console.log(`File "${wallet.address}" has been saved successfully!`);
    })
}