import { describe, it, expect } from '@jest/globals'
import {
	toPublicEventMerchantRef,
	sanitizePublicEventForFront
} from '../../../util/publicMerchant.js'

describe('publicMerchant', () => {
	it('strips sensitive merchant fields from public event payloads', () => {
		const event = {
			_id: 'evt1',
			eventTitle: 'Show',
			discountCodes: [{ code: 'SECRET', active: true }],
			merchant: {
				_id: 'm1',
				merchantId: '1000000000000000044',
				name: 'Raag',
				logo: 'https://cdn/logo.png',
				stripeAccount: 'acct_123',
				paytrailEnabled: true,
				nabilEnabled: false,
				email: 'secret@merchant.com',
				companyEmail: 'secret@merchant.com',
				bankingInfo: { iban: 'FI123' },
				apiCredentials: [{ keyId: 'k1', secretHash: 'hash' }],
				siloSettings: {
					enabled: true,
					email: { smtp: { password: { encryptedData: 'x' } } }
				},
				paytrailSubMerchantId: '99999'
			}
		}

		const sanitized = sanitizePublicEventForFront(event, {
			hasDiscountCodes: true,
			presaleAccess: false
		})

		expect(sanitized.discountCodes).toBeUndefined()
		expect(sanitized.hasDiscountCodes).toBe(true)
		expect(sanitized.presaleAccess).toBe(false)
		expect(sanitized.merchant).toEqual({
			_id: 'm1',
			merchantId: '1000000000000000044',
			name: 'Raag',
			orgName: undefined,
			logo: 'https://cdn/logo.png',
			stripeAccount: 'acct_123',
			paytrailEnabled: true,
			nabilEnabled: false
		})
		expect(sanitized.merchant.email).toBeUndefined()
		expect(sanitized.merchant.apiCredentials).toBeUndefined()
		expect(sanitized.merchant.siloSettings).toBeUndefined()
		expect(sanitized.merchant.bankingInfo).toBeUndefined()
	})

	it('toPublicEventMerchantRef returns null for empty merchant', () => {
		expect(toPublicEventMerchantRef(null)).toBeNull()
		expect(toPublicEventMerchantRef({})).toBeNull()
	})
})
