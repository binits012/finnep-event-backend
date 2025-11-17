import dotenv from 'dotenv'
dotenv.config()
import {error} from '../model/logger.js'
import jwt from 'jsonwebtoken'
import redisClient from '../model/redisConnect.js'
import * as commonUtil from '../util/common.js'
import * as JWTToken from '../model/token.js'

export const generateJWT = async (userData, cb) => {
  jwt.sign(userData, process.env.JWT_TOKEN_SECRET, {
    expiresIn: process.env.TOKEN_LIFE_SPAN,
  },  async(error, token) =>{
    //insert created token into db
    return await JWTToken.createToken(token, userData.id).then(data =>{
        commonUtil.setCacheByKey(redisClient, userData.id, data)
        cb(error, data.token)
    }).catch(err =>{
        console.log(err)
        cb(err, null)
    })
  })
}

export const generateReservationBasedJWT = async (userData, cb) =>{
    const key = userData.id
    jwt.sign(userData, process.env.JWT_TOKEN_SECRET, {
        expiresIn: process.env.TOKEN_LIFE_SPAN,
      },  async(error, token) =>{

        const data = {
            token:token,
            userId:userData.id,
            isValid:true,
            _id: key
        }
        commonUtil.setCacheByKey(redisClient, key, data)
        cb(error, token)
      })
}

export const verifyJWT = async (token, cb) => {
    if (!token) return cb(null, null)
    try {
        const myToken = token.replace("Bearer ", "")
        jwt.verify(myToken, process.env.JWT_TOKEN_SECRET, async(err, data) => {
            if(err){
                cb(err, null)
                return
            }
            // EXPLICIT REJECTION: Guest tokens not allowed for regular endpoints
            if (data.role === 'guest' || data.type === 'guest_access') {
                cb(new Error('Guest tokens not allowed for this endpoint'), null);
                return;
            }
            //check integrity of the token
            const userId = data.id
            const cacheData =  await commonUtil.getCacheByKey(redisClient, userId)

            if(cacheData === null) {
                cb(null, null)
                return
            }
            else if(cacheData.isValid && myToken === cacheData.token ){
                cb(err, data)
            }else{
                cb(err, null)
            }
        });

    } catch (e) {
        error('error',e.message)
        cb(err, null)
    }
}

export const invalidateJWT = async (token, cb) =>{
    try{
        jwt.verify(token.replace("Bearer ", ""),process.env.JWT_TOKEN_SECRET, async(err, data) => {
            // Check if there's an error or data is null before accessing data.id
            if (err || !data) {
                return cb(err, null);
            }
            const id = data.id
            await commonUtil.removeCacheByKey(redisClient,id).catch(err=>{return err})
            await JWTToken.removeTokenByUserId(id).catch(err=>{return err})
            cb(err,data)
        })
    }catch(err){
        cb(err, null)
    }
}

export const invalidateReservationBasedJWT = async (id) => {
    await commonUtil.removeCacheByKey(redisClient,id).catch(err=>{return err})

}

export const generateGuestJWT = async (email, emailCryptoId, cb) => {
    const userData = {
        email: email,
        emailCryptoId: emailCryptoId.toString(),
        role: 'guest',
        type: 'guest_access'
    };

    jwt.sign(userData, process.env.JWT_TOKEN_SECRET, {
        expiresIn: '15m' // 15 minutes
    }, async (error, token) => {
        if (error) {
            return cb(error, null);
        }
        // Store token in Redis with 15 min expiry
        const cacheKey = `guest:${emailCryptoId}`;
        const cacheData = {
            token: token,
            isValid: true,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        };
        // Set with 15 minute expiry (900 seconds)
        await commonUtil.setCacheByKey(redisClient, cacheKey, cacheData);
        // Also set expiry in Redis
        await redisClient.expire(cacheKey, 900).catch(err => {
            error('error setting Redis expiry for guest token %s', err);
        });
        cb(null, token);
    });
}

export const verifyGuestJWT = async (token, cb) => {
    if (!token) return cb(null, null);
    try {
        const myToken = token.replace("Bearer ", "");
        jwt.verify(myToken, process.env.JWT_TOKEN_SECRET, async (err, data) => {
            if (err) {
                cb(err, null);
                return;
            }
            // Verify it's a guest token
            if (data.role !== 'guest' || data.type !== 'guest_access') {
                cb(new Error('Invalid token type'), null);
                return;
            }
            // Check Redis cache
            const cacheKey = `guest:${data.emailCryptoId}`;
            const cacheData = await commonUtil.getCacheByKey(redisClient, cacheKey);
            if (cacheData === null || !cacheData.isValid || cacheData.token !== myToken) {
                cb(new Error('Token invalid or expired'), null);
                return;
            }
            cb(null, data);
        });
    } catch (e) {
        error('error', e.message);
        cb(e, null);
    }
}
