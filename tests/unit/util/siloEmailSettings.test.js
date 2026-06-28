import { describe, it, expect, beforeAll } from '@jest/globals'
import { isSiloSmtpConfigured, stripSiloEmailSecrets } from '../../../util/siloEmailSettings.js'
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
})
