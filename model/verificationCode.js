import redisClient from './redisConnect.js'
import {error} from './logger.js'
import * as CryptoLibrary from 'crypto'

const CODE_TTL_SECONDS = 5 * 60; // 5 minutes
const RATE_LIMIT_TTL_SECONDS = 60 * 60; // 1 hour for rate limiting

// Generate Redis keys
const getCodeKey = (emailCryptoId) => `verification:code:${emailCryptoId.toString()}`;
const getRateLimitKey = (emailCryptoId) => `verification:count:${emailCryptoId.toString()}`;

export const createVerificationCode = async (emailCryptoId, hashedCode) => {
    try {
        const codeKey = getCodeKey(emailCryptoId);

        // Store hashed code in Redis with 5 minute TTL
        await redisClient.set(codeKey, hashedCode);
        await redisClient.expire(codeKey, CODE_TTL_SECONDS);

        return { emailCryptoId, code: hashedCode };
    } catch (err) {
        error('error creating verification code %s', err.stack);
        throw err;
    }
}

export const findActiveCodeByEmailCryptoId = async (emailCryptoId) => {
    try {
        const codeKey = getCodeKey(emailCryptoId);
        const hashedCode = await redisClient.get(codeKey);

        if (!hashedCode) {
            return null;
        }

        return {
            emailCryptoId: emailCryptoId,
            code: hashedCode
        };
    } catch (err) {
        error('error finding verification code %s', err.stack);
        throw err;
    }
}

export const markCodeAsUsed = async (emailCryptoId) => {
    try {
        const codeKey = getCodeKey(emailCryptoId);
        // Delete the code from Redis (marking as used)
        await redisClient.del(codeKey);
        return true;
    } catch (err) {
        error('error marking code as used %s', err.stack);
        throw err;
    }
}

export const countRecentCodesByEmailCryptoId = async (emailCryptoId, hours = 1) => {
    try {
        const rateLimitKey = getRateLimitKey(emailCryptoId);
        const count = await redisClient.get(rateLimitKey);
        return count ? parseInt(count, 10) : 0;
    } catch (err) {
        error('error counting recent codes %s', err.stack);
        throw err;
    }
}

export const incrementRateLimitCounter = async (emailCryptoId) => {
    try {
        const rateLimitKey = getRateLimitKey(emailCryptoId);
        const count = await redisClient.incr(rateLimitKey);

        // Set TTL if this is the first increment (count === 1)
        if (count === 1) {
            await redisClient.expire(rateLimitKey, RATE_LIMIT_TTL_SECONDS);
        }

        return count;
    } catch (err) {
        error('error incrementing rate limit counter %s', err.stack);
        throw err;
    }
}

export const hashCode = (code) => {
    return CryptoLibrary.createHash('sha256').update(code).digest('hex');
}

export const verifyCode = (code, hashedCode) => {
    const hashedInput = hashCode(code);
    return hashedInput === hashedCode;
}

