import { describe, expect, it, jest } from '@jest/globals';
import {
	getStripeWebhookPayload,
	isStripeJsonWebhookRequest,
	resolveStripeWebhookSecret,
	resolveStripeWebhookSecrets,
	verifyStripeWebhookEvent,
} from '../util/stripeWebhook.js';

describe('stripeWebhook', () => {
	describe('resolveStripeWebhookSecret', () => {
		it('trims whitespace and wrapping quotes from env values', () => {
			expect(resolveStripeWebhookSecret(" 'whsec_test_abc' ")).toBe('whsec_test_abc');
			expect(resolveStripeWebhookSecret('"whsec_test_abc"')).toBe('whsec_test_abc');
		});
	});

	describe('resolveStripeWebhookSecrets', () => {
		it('loads platform and connect secrets separately', () => {
			const secrets = resolveStripeWebhookSecrets({
				STRIPE_WEBHOOK_SECRET: 'whsec_platform',
				STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
			});
			expect(secrets).toEqual([
				{ label: 'platform', value: 'whsec_platform' },
				{ label: 'connect', value: 'whsec_connect' },
			]);
		});

		it('deduplicates identical secrets', () => {
			const secrets = resolveStripeWebhookSecrets({
				STRIPE_WEBHOOK_SECRET: 'whsec_same',
				STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_same',
			});
			expect(secrets).toHaveLength(1);
		});
	});

	describe('verifyStripeWebhookEvent', () => {
		it('tries each configured secret until one verifies', () => {
			const stripe = {
				webhooks: {
					constructEvent: jest
						.fn()
						.mockImplementationOnce(() => {
							throw new Error('platform mismatch');
						})
						.mockImplementationOnce(() => ({ id: 'evt_1', type: 'payment_intent.succeeded' })),
				},
			};
			const payload = Buffer.from('{"id":"evt_1"}');
			const req = {
				body: payload,
				headers: { 'stripe-signature': 'sig_test' },
			};

			const result = verifyStripeWebhookEvent(stripe, req, [
				{ label: 'platform', value: 'whsec_platform' },
				{ label: 'connect', value: 'whsec_connect' },
			]);

			expect(result.secretLabel).toBe('connect');
			expect(result.event.id).toBe('evt_1');
			expect(stripe.webhooks.constructEvent).toHaveBeenCalledTimes(2);
		});
	});

	describe('getStripeWebhookPayload', () => {
		it('returns raw buffers unchanged', () => {
			const body = Buffer.from('{"id":"evt_test"}');
			expect(getStripeWebhookPayload({ body })).toBe(body);
		});
	});

	describe('isStripeJsonWebhookRequest', () => {
		it('accepts Stripe content types', () => {
			expect(
				isStripeJsonWebhookRequest({
					headers: { 'content-type': 'application/json; charset=utf-8' },
				})
			).toBe(true);
		});
	});
});
