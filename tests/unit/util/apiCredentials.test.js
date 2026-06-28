import { describe, it, expect } from '@jest/globals'
import {
	hashApiSecret,
	verifyApiSecret,
	normalizeAllowedDomains,
	isDomainAllowed,
	extractRequestHost,
	getDefaultScopes,
	sanitizeMerchantForAdmin
} from '../../../util/apiCredentials.js'

describe('apiCredentials util', () => {
	it('hashes and verifies secrets', () => {
		const secret = 'febs_test_secret_value'
		const stored = hashApiSecret(secret)
		expect(stored).toContain(':')
		expect(verifyApiSecret(secret, stored)).toBe(true)
		expect(verifyApiSecret('wrong', stored)).toBe(false)
	})

	it('normalizes allowed domains', () => {
		expect(normalizeAllowedDomains([' HTTPS://Events.Example.com/ ', 'events.example.com']))
			.toEqual(['events.example.com'])
	})

	it('checks domain allowlist with Origin host', () => {
		const credential = {
			allowedDomains: ['events.example.com'],
			serverToServer: false
		}
		expect(isDomainAllowed(credential, 'events.example.com')).toBe(true)
		expect(isDomainAllowed(credential, 'evil.example.com')).toBe(false)
	})

	it('allows server-to-server when no origin host is present', () => {
		const credential = {
			allowedDomains: ['events.example.com'],
			serverToServer: true
		}
		expect(isDomainAllowed(credential, '')).toBe(true)
	})

	it('extracts request host from Origin', () => {
		const req = { headers: { origin: 'https://events.example.com' } }
		expect(extractRequestHost(req)).toBe('events.example.com')
	})

	it('falls back to Referer host', () => {
		const req = { headers: { referer: 'https://events.example.com/events/1' } }
		expect(extractRequestHost(req)).toBe('events.example.com')
	})

	it('returns default scopes when none provided', () => {
		expect(getDefaultScopes()).toEqual(['events:read', 'merchant:read', 'waitlist:write'])
	})

	it('strips secretHash from merchant admin responses', () => {
		const merchant = {
			_id: 'm1',
			name: 'Test',
			apiCredentials: [{
				keyId: 'feb_key_abc',
				secretHash: 'salt:hash',
				allowedDomains: ['events.example.com'],
				status: 'active'
			}]
		}
		const sanitized = sanitizeMerchantForAdmin(merchant)
		expect(sanitized.apiCredentials[0].keyId).toBe('feb_key_abc')
		expect(sanitized.apiCredentials[0].secretHash).toBeUndefined()
	})

	it('flattens otherInfo maps for admin responses', () => {
		const merchant = {
			_id: 'm1',
			name: 'Test',
			otherInfo: new Map([['stripe', 150]]),
			apiCredentials: [],
		}
		const sanitized = sanitizeMerchantForAdmin(merchant)
		expect(sanitized.otherInfo).toEqual({ stripe: 150 })
	})
})
