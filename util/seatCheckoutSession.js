import crypto from 'crypto';
import redisClient from '../model/redisConnect.js';

export const SEAT_CHECKOUT_TTL_SECONDS = 600;

const emailVerifiedKey = (eventId, email) =>
	`seat_email_verified:${eventId}:${email.trim().toLowerCase()}`;

const checkoutSessionKey = (checkoutToken) => `seat_checkout_session:${checkoutToken}`;

export function normalizeSeatCheckoutEmail(email) {
	return String(email || '').trim().toLowerCase();
}

export async function setSeatEmailVerified(eventId, email) {
	const normalizedEmail = normalizeSeatCheckoutEmail(email);
	if (!normalizedEmail) return null;
	const verifiedAt = new Date().toISOString();
	await redisClient.set(
		emailVerifiedKey(eventId, normalizedEmail),
		JSON.stringify({ verifiedAt }),
		{ EX: SEAT_CHECKOUT_TTL_SECONDS }
	);
	return verifiedAt;
}

export async function refreshSeatEmailVerified(eventId, email) {
	return setSeatEmailVerified(eventId, email);
}

export async function getSeatEmailTrust(eventId, email) {
	const normalizedEmail = normalizeSeatCheckoutEmail(email);
	if (!normalizedEmail) return { trusted: false };
	const key = emailVerifiedKey(eventId, normalizedEmail);
	const raw = await redisClient.get(key);
	if (!raw) return { trusted: false };
	let verifiedAt = null;
	try {
		const parsed = JSON.parse(raw);
		verifiedAt = parsed?.verifiedAt || null;
	} catch {
		verifiedAt = null;
	}
	const ttl = await redisClient.ttl(key);
	const expiresAt =
		ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;
	return { trusted: true, verifiedAt, expiresAt, ttlSeconds: ttl > 0 ? ttl : 0 };
}

export async function createSeatCheckoutSession(payload) {
	const checkoutToken = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + SEAT_CHECKOUT_TTL_SECONDS * 1000).toISOString();
	const session = {
		checkoutToken,
		eventId: String(payload.eventId),
		email: normalizeSeatCheckoutEmail(payload.email),
		fullName: payload.fullName || '',
		sessionId: payload.sessionId,
		placeIds: Array.isArray(payload.placeIds) ? payload.placeIds : [],
		sectionSelections: Array.isArray(payload.sectionSelections) ? payload.sectionSelections : [],
		resolvedPlaceIds: Array.isArray(payload.resolvedPlaceIds) ? payload.resolvedPlaceIds : [],
		createdAt: new Date().toISOString(),
		expiresAt
	};
	await redisClient.set(checkoutSessionKey(checkoutToken), JSON.stringify(session), {
		EX: SEAT_CHECKOUT_TTL_SECONDS
	});
	return session;
}

export async function getSeatCheckoutSessionByToken(checkoutToken) {
	if (!checkoutToken || typeof checkoutToken !== 'string') return null;
	const token = checkoutToken.trim();
	const raw = await redisClient.get(checkoutSessionKey(token));
	if (!raw) return null;
	try {
		const session = JSON.parse(raw);
		const ttl = await redisClient.ttl(checkoutSessionKey(token));
		return {
			...session,
			ttlSeconds: ttl > 0 ? ttl : 0,
			expiresAt:
				ttl > 0
					? new Date(Date.now() + ttl * 1000).toISOString()
					: session.expiresAt || null
		};
	} catch {
		return null;
	}
}

export async function deleteSeatCheckoutSession(checkoutToken) {
	if (!checkoutToken) return;
	await redisClient.del(checkoutSessionKey(String(checkoutToken).trim()));
}

export async function updateSeatCheckoutSession(checkoutToken, updates) {
	if (!checkoutToken || typeof checkoutToken !== 'string') return null;
	const token = checkoutToken.trim();
	const existing = await getSeatCheckoutSessionByToken(token);
	if (!existing) return null;

	const ttl = await redisClient.ttl(checkoutSessionKey(token));
	if (ttl <= 0) return null;

	const merged = { ...existing, ...updates };
	await redisClient.set(checkoutSessionKey(token), JSON.stringify(merged), { EX: ttl });
	return merged;
}

export async function removePlaceIdsFromSeatCheckoutSession(checkoutToken, placeIdsToRemove) {
	if (!checkoutToken || !Array.isArray(placeIdsToRemove) || placeIdsToRemove.length === 0) {
		return null;
	}
	const session = await getSeatCheckoutSessionByToken(checkoutToken);
	if (!session) return null;

	const removeSet = new Set(placeIdsToRemove);
	return updateSeatCheckoutSession(checkoutToken, {
		placeIds: (session.placeIds || []).filter((id) => !removeSet.has(id)),
		resolvedPlaceIds: (session.resolvedPlaceIds || []).filter((id) => !removeSet.has(id)),
	});
}
