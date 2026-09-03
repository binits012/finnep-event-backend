import { describe, it, expect, beforeAll } from '@jest/globals'
import {
	isSiloSmtpConfigured,
	stripSiloEmailSecrets,
	resolveSiloEmailBranding,
} from '../../../util/siloEmailSettings.js'
import { encryptSiloSmtpPassword } from '../../../util/siloSmtpCrypto.js'

describe('siloEmailSettings util', () => {
	beforeAll(() => {
		process.env.CRYPTO_KEY = process.env.CRYPTO_KEY || 'test-crypto-key-minimum-32-characters-long'
	})

	it('detects configured SMTP when user is empty but fromEmail is set', () => {
		const password = encryptSiloSmtpPassword('secret')
		expect(isSiloSmtpConfigured({
			smtp: {
				host: 'smtp.example.com',
				user: '',
				fromEmail: 'events@example.com',
				password
			}
		})).toBe(true)
	})

	it('detects configured SMTP when user and fromEmail are set', () => {
		const password = encryptSiloSmtpPassword('secret')
		expect(isSiloSmtpConfigured({
			smtp: {
				host: 'smtp.example.com',
				user: 'user',
				fromEmail: 'events@example.com',
				password
			}
		})).toBe(true)
	})

	it('strips secrets from public payload', () => {
		const password = encryptSiloSmtpPassword('secret')
		const stripped = stripSiloEmailSecrets({
			replyTo: 'support@example.com',
			smtp: {
				host: 'smtp.example.com',
				port: 587,
				secure: false,
				user: 'user',
				fromEmail: 'events@example.com',
				fromName: 'Venue',
				password
			}
		})

		expect(stripped.configured).toBe(true)
		expect(stripped.smtp.passwordConfigured).toBe(true)
		expect(stripped.smtp.user).toBeUndefined()
		expect(stripped.smtp.password).toBeUndefined()
	})

	it('resolves merchant business id and social links for silo branding', () => {
		const branding = resolveSiloEmailBranding({
			code: ' 1234567-8 ',
			orgName: 'Raag',
			logo: 'https://cdn.example.com/fallback.png',
			socialMedia: new Map([
				['facebook', 'https://facebook.com/raag'],
				['linkedin', 'https://linkedin.com/company/raag'],
				['instagram', 'https://instagram.com/raag'],
			]),
			siloSettings: {
				brandConfig: {
					logoUrl: 'https://cdn.example.com/silo-logo.png',
					primaryColor: '#111111',
				},
				email: {
					replyTo: 'hello@raag.example',
					smtp: { fromName: 'Raag Tickets' },
				},
			},
		})

		expect(branding.companyName).toBe('Raag Tickets')
		expect(branding.companyLogo).toBe('https://cdn.example.com/silo-logo.png')
		expect(branding.businessId).toBe('1234567-8')
		expect(branding.socialMedidFB).toBe('https://facebook.com/raag')
		expect(branding.socialMedidLN).toBe('https://linkedin.com/company/raag')
		expect(branding.socialMedidIG).toBe('https://instagram.com/raag')
		expect(branding.replyTo).toBe('hello@raag.example')
	})
})
