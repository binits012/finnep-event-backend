import crypto from 'crypto';
import { error, info } from '../model/logger.js';

const PRESALE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const REDIS_KEY_PREFIX = 'presale_token:';

/**
 * Create a presale token for eventId + email, store in Redis with 24h TTL.
 * @param {object} redisClient - Redis client
 * @param {string} eventId - Mongo event _id
 * @param {string} email - Normalized email
 * @returns {{ token: string, key: string }}
 */
export async function createPresaleToken(redisClient, eventId, email) {
    const token = crypto.randomBytes(32).toString('hex');
    const key = REDIS_KEY_PREFIX + token;
    const value = JSON.stringify({ eventId: String(eventId), email: String(email).toLowerCase() });
    await redisClient.set(key, value, { EX: PRESALE_TTL_SECONDS });
    info('[presaleToken] created', { eventId, email: email?.slice(0, 3) + '…' });
    return { token, key };
}

/**
 * Validate presale token: return payload if valid and not expired; does NOT delete.
 * @param {object} redisClient
 * @param {string} token
 * @returns {Promise<{ eventId: string, email: string } | null>}
 */
export async function getPresalePayload(redisClient, token) {
    if (!token || typeof token !== 'string') return null;
    const key = REDIS_KEY_PREFIX + token.trim();
    const raw = await redisClient.get(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Consume (validate and delete) presale token. One-time use: call after successful purchase.
 * @param {object} redisClient
 * @param {string} token
 * @returns {Promise<{ eventId: string, email: string } | null>}
 */
export async function consumePresaleToken(redisClient, token) {
    const payload = await getPresalePayload(redisClient, token);
    if (!payload) return null;
    const key = REDIS_KEY_PREFIX + token.trim();
    await redisClient.del(key);
    info('[presaleToken] consumed', { eventId: payload.eventId });
    return payload;
}
