import { describe, it, expect } from '@jest/globals';
import {
	assertPaymentSuccessRequestMatchesSnapshot,
	buildCheckoutFulfillmentSnapshot,
	extractFulfillmentFromCheckout,
	normalizePlaceIds,
	normalizeSeatTickets,
} from '../../../util/checkoutFulfillmentSnapshot.js';

const baseMetadata = {
	eventId: '507f1f77bcf86cd799439011',
	merchantId: '507f1f77bcf86cd799439012',
	externalMerchantId: '12345',
	email: 'Buyer@Example.com',
	quantity: '2',
	ticketId: '507f1f77bcf86cd799439013',
	eventName: 'Test Event',
	ticketName: 'GA',
	nonce: 'a'.repeat(32),
	placeIds: ['seat-b', 'seat-a'],
	seatTickets: [
		{ placeId: 'seat-b', ticketId: '507f1f77bcf86cd799439013', ticketName: 'GA', pricing: { basePrice: 1 } },
		{ placeId: 'seat-a', ticketId: '507f1f77bcf86cd799439013', ticketName: 'GA', pricing: { basePrice: 1 } },
	],
	sectionSelections: [{ sectionId: 'area-1', quantity: 2 }],
};

describe('checkoutFulfillmentSnapshot', () => {
	describe('normalizePlaceIds', () => {
		it('sorts and deduplicates place ids', () => {
			expect(normalizePlaceIds(['b', 'a', 'b'])).toEqual(['a', 'b']);
		});
	});

	describe('extractFulfillmentFromCheckout', () => {
		it('normalizes email to lowercase and strips pricing_configuration seat pricing', () => {
			const fulfillment = extractFulfillmentFromCheckout({
				metadata: baseMetadata,
				parsedMetadata: baseMetadata,
				expectedPrice: { totalAmount: 42 },
				event: { venue: { venueId: 'v1', pricingModel: 'pricing_configuration' } },
			});

			expect(fulfillment.email).toBe('buyer@example.com');
			expect(fulfillment.serverCalculatedTotal).toBe(42);
			expect(fulfillment.pricingModel).toBe('pricing_configuration');
			expect(fulfillment.seatTickets).toEqual([
				{ placeId: 'seat-a', ticketId: '507f1f77bcf86cd799439013', ticketName: 'GA' },
				{ placeId: 'seat-b', ticketId: '507f1f77bcf86cd799439013', ticketName: 'GA' },
			]);
			expect(fulfillment.seatTickets[0].pricing).toBeUndefined();
		});

		it('derives placeIds from seatTickets when placeIds array is empty', () => {
			const fulfillment = extractFulfillmentFromCheckout({
				metadata: {
					...baseMetadata,
					placeIds: [],
				},
				parsedMetadata: {
					...baseMetadata,
					placeIds: [],
				},
				event: { venue: { venueId: 'v1', pricingModel: 'ticket_info' } },
			});
			expect(fulfillment.placeIds).toEqual(['seat-a', 'seat-b']);
		});
	});

	describe('buildCheckoutFulfillmentSnapshot', () => {
		it('includes stripe account and amount cents', () => {
			const snapshot = buildCheckoutFulfillmentSnapshot({
				paymentIntentId: 'pi_test_123',
				amountCents: 5000,
				currency: 'EUR',
				merchant: { stripeAccount: 'acct_test' },
				metadata: baseMetadata,
				parsedMetadata: baseMetadata,
				expectedPrice: { totalAmount: 50 },
				event: { venue: { venueId: 'v1' } },
			});

			expect(snapshot.paymentIntentId).toBe('pi_test_123');
			expect(snapshot.amountCents).toBe(5000);
			expect(snapshot.stripeAccount).toBe('acct_test');
			expect(snapshot.fulfillment.placeIds).toEqual(['seat-a', 'seat-b']);
		});
	});

	describe('assertPaymentSuccessRequestMatchesSnapshot', () => {
		const snapshot = buildCheckoutFulfillmentSnapshot({
			paymentIntentId: 'pi_test_123',
			amountCents: 5000,
			currency: 'eur',
			merchant: { stripeAccount: 'acct_test' },
			metadata: baseMetadata,
			parsedMetadata: baseMetadata,
			expectedPrice: { totalAmount: 50 },
			event: { venue: { venueId: 'v1', pricingModel: 'pricing_configuration' } },
		});

		it('passes when request metadata matches snapshot', () => {
			expect(() =>
				assertPaymentSuccessRequestMatchesSnapshot(
					{
						...baseMetadata,
						placeIds: ['seat-a', 'seat-b'],
					},
					snapshot
				)
			).not.toThrow();
		});

		it('rejects tampered eventId', () => {
			expect(() =>
				assertPaymentSuccessRequestMatchesSnapshot(
					{ ...baseMetadata, eventId: '507f1f77bcf86cd799439099' },
					snapshot
				)
			).toThrow(expect.objectContaining({ code: 'CHECKOUT_METADATA_MISMATCH', mismatches: ['eventId'] }));
		});

		it('rejects tampered placeIds', () => {
			expect(() =>
				assertPaymentSuccessRequestMatchesSnapshot(
					{ ...baseMetadata, placeIds: ['seat-a', 'seat-other'] },
					snapshot
				)
			).toThrow(expect.objectContaining({ code: 'CHECKOUT_METADATA_MISMATCH', mismatches: ['placeIds'] }));
		});

		it('allows locale-only differences', () => {
			expect(() =>
				assertPaymentSuccessRequestMatchesSnapshot(
					{ ...baseMetadata, locale: 'fi-FI' },
					snapshot
				)
			).not.toThrow();
		});
	});
});
