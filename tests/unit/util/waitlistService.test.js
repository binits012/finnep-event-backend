import { describe, it, expect } from '@jest/globals'
import { computeWaitlistOffer, mapWaitlistError } from '../../../util/waitlistService.js'

describe('waitlistService util', () => {
	it('computeWaitlistOffer returns pre_sale when enabled', () => {
		expect(computeWaitlistOffer({
			waitlistConfig: { pre_sale_enabled: true }
		})).toBe('pre_sale')
	})

	it('computeWaitlistOffer returns sold_out when tier sold out', () => {
		expect(computeWaitlistOffer({
			waitlistConfig: { sold_out_enabled: true },
			ticketInfo: [{ status: 'available' }, { status: 'sold_out' }]
		})).toBe('sold_out')
	})

	it('computeWaitlistOffer returns null for free events', () => {
		expect(computeWaitlistOffer({
			otherInfo: { eventExtraInfo: { eventType: 'free' } },
			waitlistConfig: { pre_sale_enabled: true }
		})).toBeNull()
	})

	it('mapWaitlistError maps structured silo errors', () => {
		const err = Object.assign(new Error('Silo storefront is not enabled'), {
			status: 400,
			code: 'SILO_NOT_ENABLED'
		})
		expect(mapWaitlistError(err)).toEqual({
			status: 400,
			body: {
				error: 'SILO_NOT_ENABLED',
				message: 'Silo storefront is not enabled'
			}
		})
	})
})
