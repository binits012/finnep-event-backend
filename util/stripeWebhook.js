/**
 * Stripe webhook helpers — signature verification requires the raw request body.
 *
 * Connect platforms typically register two dashboard endpoints (same URL is fine):
 * - "Your account" events        → STRIPE_WEBHOOK_SECRET
 * - "Connected accounts" events  → STRIPE_CONNECT_WEBHOOK_SECRET
 *
 * Each endpoint has its own whsec_… signing secret.
 */

export function resolveStripeWebhookSecret(raw) {
	if (!raw || typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	return trimmed.replace(/^['"]|['"]$/g, '');
}

/**
 * @returns {{ label: 'platform' | 'connect' | 'list', value: string }[]}
 */
export function resolveStripeWebhookSecrets(env = process.env) {
	const seen = new Set();
	const secrets = [];

	const add = (raw, label) => {
		const value = resolveStripeWebhookSecret(raw);
		if (!value || seen.has(value)) return;
		seen.add(value);
		secrets.push({ label, value });
	};

	const list = env.STRIPE_WEBHOOK_SECRETS;
	if (list && typeof list === 'string') {
		for (const part of list.split(',')) {
			add(part, 'list');
		}
	}

	add(env.STRIPE_WEBHOOK_SECRET, 'platform');
	add(env.STRIPE_CONNECT_WEBHOOK_SECRET, 'connect');

	return secrets;
}

export function isStripeJsonWebhookRequest(req) {
	const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
	return contentType.includes('application/json');
}

export function getStripeWebhookPayload(req) {
	const body = req?.body;
	if (Buffer.isBuffer(body)) return body;
	if (typeof body === 'string') return body;
	return null;
}

/**
 * Verify Stripe-Signature against one or more endpoint secrets.
 * @returns {{ event: object, secretLabel: string }}
 */
export function verifyStripeWebhookEvent(stripe, req, webhookSecrets) {
	const signature = req?.headers?.['stripe-signature'];
	if (!signature) {
		const err = new Error('Missing stripe-signature header');
		err.code = 'STRIPE_WEBHOOK_MISSING_SIGNATURE';
		throw err;
	}

	const payload = getStripeWebhookPayload(req);
	if (!payload) {
		const err = new Error(
			'Webhook body is not raw JSON (signature verification requires the unparsed request body)'
		);
		err.code = 'STRIPE_WEBHOOK_BODY_NOT_RAW';
		throw err;
	}

	const candidates = Array.isArray(webhookSecrets)
		? webhookSecrets
		: webhookSecrets
			? [{ label: 'platform', value: webhookSecrets }]
			: [];

	if (candidates.length === 0) {
		const err = new Error('No Stripe webhook signing secrets configured');
		err.code = 'STRIPE_WEBHOOK_NO_SECRETS';
		throw err;
	}

	let lastError = null;
	for (const { label, value } of candidates) {
		try {
			const event = stripe.webhooks.constructEvent(payload, signature, value);
			return { event, secretLabel: label };
		} catch (err) {
			lastError = err;
		}
	}

	const err = new Error(
		lastError?.message ||
			'Webhook signature did not match any configured Stripe endpoint secret'
	);
	err.code = 'STRIPE_WEBHOOK_SIGNATURE_MISMATCH';
	err.cause = lastError;
	throw err;
}
