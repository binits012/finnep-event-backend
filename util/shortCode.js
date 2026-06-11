import crypto from 'crypto';
import redisClient from '../model/redisConnect.js';

export const SHORT_CODE_LENGTH = 6;
export const SHORT_CODE_PATTERN = /^[a-zA-Z0-9]{6}$/;
export const SHORTLINK_REDIS_PREFIX = 'shortlink:';
export const SHORTLINK_EVENT_REDIS_PREFIX = 'shortlink:event:';

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a random 6-character base62 short code.
 * @returns {string}
 */
export function generateShortCode() {
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    const index = crypto.randomInt(0, BASE62_CHARS.length);
    code += BASE62_CHARS[index];
  }
  return code;
}

/**
 * @param {string} shortCode
 * @returns {boolean}
 */
export function isValidShortCode(shortCode) {
  return typeof shortCode === 'string' && SHORT_CODE_PATTERN.test(shortCode);
}

/**
 * @param {string} shortCode
 * @param {string} eventId - Mongo ObjectId hex string
 * @returns {Promise<void>}
 */
export async function cacheShortCodeMapping(shortCode, eventId) {
  if (!isValidShortCode(shortCode) || !eventId) {
    return;
  }
  const normalizedEventId = String(eventId).trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(normalizedEventId)) {
    return;
  }
  const key = `${SHORTLINK_REDIS_PREFIX}${shortCode}`;
  await redisClient.set(key, JSON.stringify({ eventId: normalizedEventId }));
  await redisClient.set(`${SHORTLINK_EVENT_REDIS_PREFIX}${normalizedEventId}`, shortCode);
}

/**
 * Generate a unique short code, retrying on collision against Mongo Event collection.
 * @param {import('mongoose').Model} EventModel
 * @param {number} [maxAttempts=5]
 * @returns {Promise<string>}
 */
export async function generateUniqueShortCode(EventModel, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateShortCode();
    const existing = await EventModel.findOne({ shortCode: candidate }).select('_id').lean();
    if (!existing) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique shortCode after maximum attempts');
}
