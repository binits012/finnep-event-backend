import crypto from 'crypto';
import { info } from '../model/logger.js';

const SURVEY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const REDIS_KEY_PREFIX = 'survey_token:';

/**
 * Create a survey link token; payload has MongoDB survey _id + recipient (no eventId).
 * Link format: /survey/{mongoSurveyId}?token=...
 * @param {object} redisClient - Redis client
 * @param {string} surveyIdMongo - MongoDB survey _id (24-char hex)
 * @param {string} recipientIdentifier - e.g. email (normalized)
 * @returns {{ token: string, key: string }}
 */
export async function createSurveyToken(redisClient, surveyIdMongo, recipientIdentifier) {
	const token = crypto.randomBytes(32).toString('hex');
	const key = REDIS_KEY_PREFIX + token;
	const value = JSON.stringify({
		surveyId: String(surveyIdMongo),
		recipientIdentifier: String(recipientIdentifier).toLowerCase()
	});
	await redisClient.set(key, value, { EX: SURVEY_TTL_SECONDS });
	info('[surveyToken] created', { surveyId: surveyIdMongo, recipient: recipientIdentifier?.slice(0, 3) + '…' });
	return { token, key };
}

/**
 * Validate survey token: return payload if valid and not expired; does NOT delete.
 * @param {object} redisClient
 * @param {string} token
 * @returns {Promise<{ surveyId: string, recipientIdentifier: string } | null>}
 */
export async function getSurveyTokenPayload(redisClient, token) {
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
 * Consume (validate and mark used) survey token. One-time use for submit; token stays in Redis with used: true
 * so GET /survey/:id?token=... can still return 200 with submitted: true for thank-you view.
 * @param {object} redisClient
 * @param {string} token
 * @returns {Promise<{ surveyId: string, recipientIdentifier: string } | null>}
 */
export async function consumeSurveyToken(redisClient, token) {
	const payload = await getSurveyTokenPayload(redisClient, token);
	if (!payload) return null;
	const key = REDIS_KEY_PREFIX + token.trim();
	await redisClient.set(key, JSON.stringify({ ...payload, used: true }), { EX: SURVEY_TTL_SECONDS });
	info('[surveyToken] consumed', { surveyId: payload.surveyId });
	return payload;
}
