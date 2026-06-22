import { describe, it, expect } from '@jest/globals'
import {
	extractCheckoutHostname,
	hostnameMatchesSiloDomain,
	shouldUseSiloTicketEmail
} from '../../../util/siloCheckoutEmail.js'

describe('siloCheckoutEmail', () => {
	it('extracts checkout hostname from Origin header', () => {
		const req = {
			get: (name) => (name === 'Origin' ? 'https://tickets.merchant.com' : null),
			body: {}
		}
		expect(extractCheckoutHostname({ req })).toBe('tickets.merchant.com')
	})

	it('matches silo domain and subdomains', () => {
		expect(hostnameMatchesSiloDomain('tickets.merchant.com', 'merchant.com')).toBe(true)
		expect(hostnameMatchesSiloDomain('merchant.com', 'merchant.com')).toBe(true)
		expect(hostnameMatchesSiloDomain('okazzo.eu', 'merchant.com')).toBe(false)
	})

	it('uses silo email when merchant silo SMTP is configured and hostname matches', () => {
		const merchant = {
			siloSettings: {
				enabled: true,
				domain: 'merchant.com',
				email: {
					smtp: {
						host: 'smtp.example.com',
						user: 'smtp-user',
						fromEmail: 'tickets@merchant.com',
						password: { iv: 'iv', encryptedData: 'data' }
					}
				}
			}
		}
		expect(shouldUseSiloTicketEmail(merchant, 'localhost')).toBe(true)
		expect(shouldUseSiloTicketEmail(merchant, 'tickets.merchant.com')).toBe(true)
		expect(shouldUseSiloTicketEmail(merchant, 'okazzo.eu')).toBe(false)
	})
})
