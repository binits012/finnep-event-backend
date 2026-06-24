import redisClient from '../model/redisConnect.js';
import { resolveBrandingContactEmail } from './common.js';
import { sendCheckoutSnapshotExpiredAdminEmail } from './sendMail.js';
import { error, info } from '../model/logger.js';

export const CHECKOUT_SNAPSHOT_TTL_SECONDS = 86400;
export const CHECKOUT_SNAPSHOT_ADMIN_ALERT_TTL_SECONDS = 86400;

const snapshotKey = (paymentIntentId) => `checkout_snapshot:${paymentIntentId}`;
const adminAlertKey = (paymentIntentId) => `checkout_snapshot_admin_alert:${paymentIntentId}`;

const parseArrayField = (value) => {
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string') return [];
	const trimmed = value.trim();
	if (!trimmed || trimmed === '[]' || trimmed === 'null') return [];
	try {
		const parsed = JSON.parse(trimmed);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

export const normalizePlaceIds = (input) =>
	Array.from(
		new Set(
			parseArrayField(input)
				.map((id) => (typeof id === 'string' ? id.trim() : ''))
				.filter((id) => id.length > 0)
		)
	).sort();

export const normalizeSectionSelections = (input) =>
	parseArrayField(input)
		.map((raw) => ({
			sectionId: String(raw?.sectionId || '').trim(),
			sectionName: String(raw?.sectionName || '').trim(),
			quantity: Number(raw?.quantity || 0),
		}))
		.filter((item) => (item.sectionId || item.sectionName) && item.quantity > 0)
		.sort((a, b) =>
			`${a.sectionId}|${a.sectionName}|${a.quantity}`.localeCompare(
				`${b.sectionId}|${b.sectionName}|${b.quantity}`
			)
		);

export const normalizeSeatTickets = (input) =>
	parseArrayField(input)
		.map((raw) => ({
			placeId: String(raw?.placeId || '').trim(),
			ticketId: raw?.ticketId != null ? String(raw.ticketId).trim() : '',
			ticketName: raw?.ticketName != null ? String(raw.ticketName).trim() : '',
		}))
		.filter((item) => item.placeId.length > 0)
		.sort((a, b) => `${a.placeId}|${a.ticketId}`.localeCompare(`${b.placeId}|${b.ticketId}`));

const stableStringify = (value) => JSON.stringify(value);

const stripClientPricingFromSeatTickets = (seatTickets = []) =>
	normalizeSeatTickets(seatTickets).map(({ placeId, ticketId, ticketName }) => ({
		placeId,
		ticketId,
		ticketName,
	}));

export function extractFulfillmentFromCheckout({
	metadata = {},
	parsedMetadata = {},
	expectedPrice = null,
	event = null,
}) {
	const source = { ...metadata, ...parsedMetadata };
	const isPricingConfiguration = event?.venue?.pricingModel === 'pricing_configuration';
	let placeIds = normalizePlaceIds(source.placeIds);
	const seatTickets = isPricingConfiguration
		? stripClientPricingFromSeatTickets(source.seatTickets)
		: normalizeSeatTickets(source.seatTickets);
	if (placeIds.length === 0 && seatTickets.length > 0) {
		placeIds = seatTickets.map((seat) => seat.placeId).filter((id) => id.length > 0);
	}
	const sectionSelections = normalizeSectionSelections(source.sectionSelections);

	return {
		eventId: String(source.eventId || ''),
		ticketId: source.ticketId != null && String(source.ticketId).trim() ? String(source.ticketId).trim() : null,
		merchantId: String(source.merchantId || ''),
		externalMerchantId: String(source.externalMerchantId || ''),
		email: String(source.email || '').trim().toLowerCase(),
		quantity: String(source.quantity ?? '1'),
		eventName: source.eventName != null ? String(source.eventName) : '',
		ticketName: source.ticketName != null ? String(source.ticketName) : '',
		marketingOptIn: source.marketingOptIn === true || String(source.marketingOptIn || '').trim() === '1',
		placeIds,
		seatTickets,
		sectionSelections,
		sessionId: source.sessionId != null ? String(source.sessionId).trim() : null,
		checkoutToken: source.checkoutToken != null ? String(source.checkoutToken).trim() : null,
		fullName: source.fullName != null ? String(source.fullName) : null,
		locale: source.locale != null ? String(source.locale) : null,
		nonce: source.nonce != null ? String(source.nonce) : null,
		presaleToken: source.presaleToken != null ? String(source.presaleToken) : null,
		country: source.country != null ? String(source.country) : null,
		basePrice: source.basePrice,
		serviceFee: source.serviceFee,
		vatRate: source.vatRate,
		vatAmount: source.vatAmount,
		totalVatAmount: source.totalVatAmount,
		entertainmentTax: source.entertainmentTax,
		entertainmentTaxAmount: source.entertainmentTaxAmount,
		serviceTax: source.serviceTax,
		serviceTaxAmount: source.serviceTaxAmount,
		orderFee: source.orderFee,
		orderFeeServiceTax: source.orderFeeServiceTax,
		totalBasePrice: source.totalBasePrice,
		totalServiceFee: source.totalServiceFee,
		couponCode: source.couponCode != null ? String(source.couponCode).trim() : null,
		couponId: source.couponId != null ? String(source.couponId).trim() : null,
		couponDiscountAmount: source.couponDiscountAmount,
		catalogBaseSubtotal: source.catalogBaseSubtotal,
		serverCalculatedTotal: expectedPrice?.totalAmount ?? null,
		pricingModel: event?.venue?.pricingModel || null,
		isVenueEvent: Boolean(event?.venue?.venueId),
	};
}

export function buildCheckoutFulfillmentSnapshot({
	paymentIntentId,
	amountCents,
	currency,
	merchant,
	metadata,
	parsedMetadata,
	expectedPrice,
	event,
}) {
	return {
		version: 1,
		paymentIntentId,
		amountCents,
		currency: String(currency || '').toLowerCase(),
		stripeAccount: merchant?.stripeAccount || null,
		nonce: metadata?.nonce || parsedMetadata?.nonce || null,
		eventId: String(metadata?.eventId || parsedMetadata?.eventId || ''),
		merchantId: String(metadata?.merchantId || parsedMetadata?.merchantId || ''),
		externalMerchantId: String(metadata?.externalMerchantId || parsedMetadata?.externalMerchantId || ''),
		fulfillment: extractFulfillmentFromCheckout({ metadata, parsedMetadata, expectedPrice, event }),
		createdAt: new Date().toISOString(),
	};
}

export async function saveCheckoutFulfillmentSnapshot(snapshot) {
	if (!snapshot?.paymentIntentId) {
		throw new Error('Missing paymentIntentId for checkout snapshot');
	}
	await redisClient.set(snapshotKey(snapshot.paymentIntentId), JSON.stringify(snapshot), {
		EX: CHECKOUT_SNAPSHOT_TTL_SECONDS,
	});
	return snapshot;
}

export async function getCheckoutFulfillmentSnapshot(paymentIntentId) {
	if (!paymentIntentId) return null;
	const raw = await redisClient.get(snapshotKey(paymentIntentId));
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function deleteCheckoutFulfillmentSnapshot(paymentIntentId) {
	if (!paymentIntentId) return;
	await redisClient.del(snapshotKey(paymentIntentId));
}

/**
 * Reject payment-success when the client body disagrees with the server snapshot.
 * Locale may differ (email template only).
 */
export function assertPaymentSuccessRequestMatchesSnapshot(requestMetadata = {}, snapshot) {
	const fulfillment = snapshot?.fulfillment;
	if (!fulfillment) {
		const err = new Error('Checkout snapshot is invalid');
		err.code = 'CHECKOUT_SNAPSHOT_INVALID';
		throw err;
	}

	const requestPlaceIds = normalizePlaceIds(requestMetadata.placeIds);
	const requestSeatTickets = normalizeSeatTickets(requestMetadata.seatTickets);
	const requestSectionSelections = normalizeSectionSelections(requestMetadata.sectionSelections);

	const mismatches = [];

	const compare = (field, requestValue, snapshotValue) => {
		if (requestValue !== snapshotValue) {
			mismatches.push(field);
		}
	};

	compare('eventId', String(requestMetadata.eventId || ''), fulfillment.eventId);
	compare('merchantId', String(requestMetadata.merchantId || ''), fulfillment.merchantId);
	compare(
		'externalMerchantId',
		String(requestMetadata.externalMerchantId || ''),
		fulfillment.externalMerchantId
	);
	compare('email', String(requestMetadata.email || '').trim().toLowerCase(), fulfillment.email);
	compare('quantity', String(requestMetadata.quantity ?? ''), fulfillment.quantity);

	const requestTicketId =
		requestMetadata.ticketId != null && String(requestMetadata.ticketId).trim()
			? String(requestMetadata.ticketId).trim()
			: null;
	if (requestTicketId !== fulfillment.ticketId) {
		mismatches.push('ticketId');
	}

	if (stableStringify(requestPlaceIds) !== stableStringify(fulfillment.placeIds || [])) {
		mismatches.push('placeIds');
	}
	if (stableStringify(requestSeatTickets) !== stableStringify(fulfillment.seatTickets || [])) {
		mismatches.push('seatTickets');
	}
	if (
		stableStringify(requestSectionSelections) !==
		stableStringify(fulfillment.sectionSelections || [])
	) {
		mismatches.push('sectionSelections');
	}

	if (requestMetadata.couponCode != null && String(requestMetadata.couponCode).trim()) {
		compare(
			'couponCode',
			String(requestMetadata.couponCode).trim(),
			fulfillment.couponCode || ''
		);
	}
	if (requestMetadata.presaleToken != null && String(requestMetadata.presaleToken).trim()) {
		compare(
			'presaleToken',
			String(requestMetadata.presaleToken).trim(),
			fulfillment.presaleToken || ''
		);
	}

	if (mismatches.length > 0) {
		const err = new Error('Checkout metadata does not match payment session');
		err.code = 'CHECKOUT_METADATA_MISMATCH';
		err.mismatches = mismatches;
		throw err;
	}
}

/**
 * Log and email platform admin once per PaymentIntent when snapshot is missing at finalize.
 * Non-blocking for the HTTP response.
 */
export async function notifyAdminMissingCheckoutSnapshot({
	paymentIntentId,
	metadata = {},
	clientId = null,
	stripePaymentSummary = null,
}) {
	if (!paymentIntentId) return;

	const reserveResult = await redisClient.set(
		adminAlertKey(paymentIntentId),
		JSON.stringify({ notifiedAt: new Date().toISOString(), clientId }),
		{ NX: true, EX: CHECKOUT_SNAPSHOT_ADMIN_ALERT_TTL_SECONDS }
	);
	if (reserveResult === null) {
		info('[notifyAdminMissingCheckoutSnapshot] Admin alert already sent', { paymentIntentId });
		return;
	}

	const placeIds = normalizePlaceIds(metadata.placeIds);
	const alertDetails = {
		paymentIntentId,
		customerEmail: metadata.email || stripePaymentSummary?.email || null,
		eventId: metadata.eventId || stripePaymentSummary?.eventId || null,
		eventName: metadata.eventName || null,
		merchantId: metadata.merchantId || null,
		externalMerchantId: metadata.externalMerchantId || null,
		placeIds,
		clientId,
		stripeStatus: stripePaymentSummary?.status || null,
		stripeAmountCents: stripePaymentSummary?.amountCents ?? null,
		stripeCurrency: stripePaymentSummary?.currency || null,
		stripeRetrieveError: stripePaymentSummary?.retrieveError || null,
	};

	error('[notifyAdminMissingCheckoutSnapshot] Checkout snapshot missing at payment-success', alertDetails);

	const adminEmail = resolveBrandingContactEmail();
	void sendCheckoutSnapshotExpiredAdminEmail(adminEmail, alertDetails).catch((mailErr) => {
		error('[notifyAdminMissingCheckoutSnapshot] Failed to send admin email', {
			paymentIntentId,
			adminEmail,
			error: mailErr?.message || String(mailErr),
		});
	});
}
