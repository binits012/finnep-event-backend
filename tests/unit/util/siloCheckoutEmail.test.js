import { describe, it, expect } from '@jest/globals'
import {
	extractCheckoutHostname,
	hostnameMatchesSiloDomain,
	shouldUseSiloTicketEmail,
	buildSiloTicketEmailOptionsFromPaymentData
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

	it('extracts checkout hostname from fulfillment snapshot', () => {
		expect(extractCheckoutHostname({
			req: { get: () => null, body: {} },
			fulfillment: { checkoutHostname: 'aayogorkhalievents.okazzo.eu' },
		})).toBe('aayogorkhalievents.okazzo.eu')
	})

	it('prefers fulfillment snapshot hostname over Origin header', () => {
		const req = {
			get: (name) => (name === 'Origin' ? 'https://api.okazzo.eu' : null),
			body: {},
		}
		expect(extractCheckoutHostname({
			req,
			fulfillment: { checkoutHostname: 'aayogorkhalievents.okazzo.eu' },
		})).toBe('aayogorkhalievents.okazzo.eu')
	})

	it('resolveSiloCheckoutChannel returns silo for matching hostname', async () => {
		const { resolveSiloCheckoutChannel } = await import('../../../util/siloCheckoutEmail.js')
		const merchant = {
			siloSettings: {
				enabled: true,
				domain: 'aayogorkhalievents.okazzo.eu',
			},
		}
		expect(resolveSiloCheckoutChannel(merchant, 'aayogorkhalievents.okazzo.eu')).toBe('silo')
		expect(resolveSiloCheckoutChannel(merchant, 'okazzo.eu')).toBe('marketplace')
	})

	it('uses silo email when silo is enabled and hostname matches', () => {
		const merchant = {
			siloSettings: {
				enabled: true,
				domain: 'merchant.com'
			}
		}
		expect(shouldUseSiloTicketEmail(merchant, 'localhost')).toBe(true)
		expect(shouldUseSiloTicketEmail(merchant, 'tickets.merchant.com')).toBe(true)
		expect(shouldUseSiloTicketEmail(merchant, 'okazzo.eu')).toBe(false)
	})

	it('matches CloudFront domain when custom silo domain is unset', () => {
		const merchant = {
			siloSettings: {
				enabled: true,
				domain: '',
				deployment: {
					cloudfrontDomainName: 'd2f0530enrkby2.cloudfront.net'
				}
			}
		}
		expect(shouldUseSiloTicketEmail(merchant, 'd2f0530enrkby2.cloudfront.net')).toBe(true)
		expect(shouldUseSiloTicketEmail(merchant, 'wrong.cloudfront.net')).toBe(false)
	})

	it('returns silo options from payment data when configured', () => {
		const merchant = {
			_id: 'merchant_123',
			siloSettings: {
				enabled: true,
				domain: 'raagrevolution.okazzo.eu',
				email: {
					smtp: {
						host: 'smtp.example.com',
						user: 'smtp-user',
						fromEmail: 'tickets@raagrevolution.okazzo.eu',
						password: { iv: 'iv', encryptedData: 'data' }
					}
				}
			}
		}
		const paymentData = {
			eventId: 'event_123',
			checkoutHostname: 'raagrevolution.okazzo.eu'
		}

		const result = buildSiloTicketEmailOptionsFromPaymentData(merchant, paymentData)
		expect(result.channel).toBe('silo')
		expect(result.merchant).toBe(merchant)
		expect(result.checkoutHostname).toBe('raagrevolution.okazzo.eu')
	})

	it('returns base options when checkoutHostname missing from payment data', () => {
		const merchant = {
			_id: 'merchant_123',
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
		const paymentData = {
			eventId: 'event_123'
			// Missing checkoutHostname
		}

		const result = buildSiloTicketEmailOptionsFromPaymentData(merchant, paymentData)
		expect(result.channel).toBeUndefined()
		expect(result.merchant).toBeUndefined()
		expect(result.marketCountryCode).toBe(null)
	})

	it('returns base options when merchant not provided', () => {
		const paymentData = {
			eventId: 'event_123',
			checkoutHostname: 'merchant.com'
		}

		const result = buildSiloTicketEmailOptionsFromPaymentData(null, paymentData)
		expect(result.channel).toBeUndefined()
		expect(result.marketCountryCode).toBe(null)
	})

	it('returns base options when hostname does not match silo domain', () => {
		const merchant = {
			_id: 'merchant_123',
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
		const paymentData = {
			eventId: 'event_123',
			checkoutHostname: 'wrongdomain.com'
		}

		const result = buildSiloTicketEmailOptionsFromPaymentData(merchant, paymentData)
		expect(result.channel).toBeUndefined()
		expect(result.marketCountryCode).toBe(null)
	})
})
