import { createHashData } from '../../util/createHash.js';
import { getCryptoBySearchIndex } from '../../model/crypto.js';
import { PlatformMarketingConsent } from '../../model/mongoModel.js';
import { inboxModel } from '../../model/inboxMessage.js';
import { error, info, warn } from '../../model/logger.js';

/**
 * EMS backoffice publishes customer.created (outbox) with plaintext email + aggregate platformMarketingOptIn.
 * Upsert Mongo cryptos + platformmarketingconsents for the FinnishEventApp buyer identity.
 *
 * Inbox (Mongo `InboxMessage`): same idempotency pattern as merchant/event handlers — EMS sends
 * `metaData.causationId`; legacy payloads fall back to a deterministic synthetic id.
 */
export const handleCustomerMessage = async (message) => {
	if (!message || typeof message !== 'object') {
		error('[customerHandler] invalid message', { message });
		throw new Error('Message must be an object');
	}

	const payload = message?.data && typeof message.data === 'object' ? message.data : message;
	// Prefer AMQP envelope (set by messageConsumer) so we never drop events when JSON body omits routing metadata.
	const routingKeyRaw =
		message?.routingKey ??
		message?.routing_key ??
		payload?.routing_key ??
		payload?.routingKey;
	const routingKey =
		typeof routingKeyRaw === 'string' ? routingKeyRaw.trim() : routingKeyRaw != null ? String(routingKeyRaw) : '';

	if (routingKey !== 'customer.created') {
		info('[customerHandler] ignoring routing_key', { routingKey: routingKey || null });
		return;
	}

	const email = typeof payload.email === 'string' ? payload.email.trim() : '';
	if (!email || !email.includes('@')) {
		error('[customerHandler] missing or invalid email', { payload });
		throw new Error('customer.created: valid email required');
	}

	const causationId = payload?.metaData?.causationId ?? message?.metaData?.causationId;
	const messageId =
		typeof causationId === 'string' && causationId.trim()
			? causationId.trim()
			: payload?.merchant_id != null && payload?.customer_id != null
				? `customer.created:${String(payload.merchant_id)}:${String(payload.customer_id)}:${email}`
				: null;

	if (!messageId) {
		error('[customerHandler] cannot derive inbox message id (causationId or merchant_id + customer_id + email)');
		throw new Error('customer.created: idempotency key required');
	}

	if (await inboxModel.isProcessed(messageId)) {
		info('[customerHandler] already processed, skipping', { messageId });
		return;
	}

	try {
		await inboxModel.saveMessage({
			messageId,
			eventType: 'customer.created',
			aggregateId:
				payload?.customer_id != null
					? String(payload.customer_id)
					: payload?.merchant_id != null
						? String(payload.merchant_id)
						: undefined,
			data: message,
			metadata: payload?.metaData || message?.metaData || { receivedAt: new Date() }
		});
	} catch (saveError) {
		if (saveError?.code === 11000) {
			const already = await inboxModel.isProcessed(messageId);
			if (already) {
				info('[customerHandler] duplicate inbox row, already processed', { messageId });
				return;
			}
		}
		throw saveError;
	}

	if (!causationId) {
		warn('[customerHandler] missing metaData.causationId — used synthetic inbox key', { messageId });
	}

	const platformMarketingOptIn = Boolean(payload.platformMarketingOptIn);

	const existing = await getCryptoBySearchIndex(email, 'email');
	let emailCryptoId;
	if (Array.isArray(existing) && existing.length > 0 && existing[0]._id) {
		emailCryptoId = existing[0]._id;
	} else {
		const created = await createHashData(email, 'email');
		emailCryptoId = created._id;
	}

	await PlatformMarketingConsent.updatePlatformConsent(emailCryptoId, platformMarketingOptIn);

	await inboxModel.markProcessed(messageId);

	info('[customerHandler] platform consent upserted', {
		merchantId: payload.merchant_id,
		customerId: payload.customer_id,
		emailCryptoId: String(emailCryptoId),
		platformMarketingOptIn,
		messageId
	});
};
