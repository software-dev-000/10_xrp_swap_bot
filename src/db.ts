import mongoose from 'mongoose';
import * as utils from './utils';

export const User = mongoose.model(
    "User",
    new mongoose.Schema({
        chatid: String,
        username: String,
        depositWallet: String,
        addr: String,
        timestamp: Number,
        tokens: [String],
        wallets: [String],
        limitOrderExpire: Number,

        referralLink: String,
        referredBy: String,
        referredTimestamp: Number,
        referralWallet: String,
        referralEarning: Number,
    })
);

export const LimitOrder = mongoose.model(
    "LimitOrder",
    new mongoose.Schema({
        userid: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        tokenName: String,
        tokenAddr: String,
        depositWallet: String,
        orderType: String,
        intervalId: Number,
        txHash: String,
        targetPrice: String,
        orderAmount: String,
        status: Number,
        createdAt: Number,
        updatedAt: Number,
        deletedAt: Number,
    })
);

export const init = () => {
    return new Promise(async (resolve: any, reject: any) => {
        mongoose
            .connect(`mongodb://localhost:27017/${process.env.DB_NAME}`)
            .then(() => {
                console.log(`Connected to MongoDB "${process.env.DB_NAME}"...`);

                resolve();
            })
            .catch((err: any) => {
                console.error("Could not connect to MongoDB...", err);
                reject();
            });
    });
};

export const createLimitOrder = (params: any) => {
    return new Promise(async (resolve, reject) => {
        const limitOrder = new LimitOrder();
        limitOrder.userid = params.userid;
        limitOrder.tokenAddr = params.tokenAddr;
        limitOrder.tokenName = params.tokenName;
        limitOrder.depositWallet = params.depositWallet;
        limitOrder.orderType = params.orderType;
        limitOrder.intervalId = params.intervalId;
        limitOrder.txHash = params.txHash;
        limitOrder.targetPrice = params.targetPrice;
        limitOrder.orderAmount = params.orderAmount;
        limitOrder.status = params.status;
        limitOrder.createdAt = Date.now();
        limitOrder.updatedAt = Date.now();

        await limitOrder.save();
        resolve(limitOrder);
    });
};

export const updateLimitOrder = (params: any) => {
    return new Promise(async (resolve, reject) => {
        const limitOrder = await LimitOrder.findOne({ _id: params._id});
        if (!limitOrder) {
            reject(new Error('Limit order not found'));
        } else {
        limitOrder.status = 0;
        limitOrder.txHash = params.txHash ?? "";
        limitOrder.updatedAt = Date.now();

        await limitOrder.save();
            resolve(limitOrder);
        }
    });
};

export const setIntervalId = (params: any) => {
    return new Promise(async (resolve, reject) => {
        const limitOrder = await LimitOrder.findOne({ _id: params._id});
        if (!limitOrder) {
            reject(new Error('Limit order not found'));
        } else {
        limitOrder.intervalId = params.intervalId;
        limitOrder.updatedAt = Date.now();

        await limitOrder.save();
            resolve(limitOrder);
        }
    });
};

export const selectLimitOrders = (params: any) => {
    return new Promise(async (resolve, reject) => {
        const limitOrders = await LimitOrder.find({
            userid: params.userid,
            tokenAddr: params.tokenAddr,
            status: 1
        });
        resolve(limitOrders);
    });
};

export const removeLimitOrder = (params: any) => {
    return new Promise(async (resolve, reject) => {
        const limitOrder = await LimitOrder.findOne({ _id: params.id});
        if (!limitOrder) {
            reject(new Error('Limit order not found'));
        } else {
            limitOrder.status = params.status;
            limitOrder.updatedAt = Date.now();
            await limitOrder.save();
        resolve(limitOrder);
        }
    });
};

export const updateUser = (params: any) => {
    // console.log(`update User => ${JSON.stringify(params, null, 2)}`);
    return new Promise(async (resolve, reject) => {
        User.findOne({ chatid: params.chatid }).then(async (user: any) => {
            if (!user) {
                user = new User();
            }

            user.chatid = params.chatid;
            user.username = params.username ?? "";

            user.depositWallet = params.depositWallet
            if (params.depositWallet) {
                if (user.wallets) {
                    if (!user.wallets.includes(params.depositWallet))
                        user.wallets.push(params.depositWallet)
                } else {
                    user.wallets = [params.depositWallet]
                }
            }

            user.addr = params.addr ?? "";
            if (params.addr) {
                if (user.tokens) {
                    if (!user.tokens.includes(params.addr))
                        user.tokens.push(params.addr)
                } else {
                    user.tokens = [params.addr]
                }
            }

            user.limitOrderExpire = params.user?.limitOrderExpire || 3600;

            user.referralLink = params.referralLink;
            user.referredBy = params.referredBy;
            user.referredTimestamp = params.referredTimestamp;
            user.referralWallet = params.referralWallet;
            user.referralEarning = params.referralEarning;

            await user.save();

            resolve(user);
        });
    });
};

export const removeUser = (params: any) => {
    return new Promise((resolve, reject) => {
        User.deleteOne({ chatid: params.chatid }).then(() => {
            resolve(true);
        });
    });
};

export async function selectUsers(params: any = {}) {
    return new Promise(async (resolve, reject) => {
        User.find(params).then(async (users: any) => {
            resolve(users);
        });
    });
}

export async function countUsers(params: any = {}) {
    return new Promise(async (resolve, reject) => {
        User.countDocuments(params).then(async (users: any) => {
            resolve(users);
        });
    });
}

export async function selectUser(params: any) {
    return new Promise(async (resolve, reject) => {
        User.findOne(params).then(async (user: any) => {
            resolve(user);
        });
    });
}
