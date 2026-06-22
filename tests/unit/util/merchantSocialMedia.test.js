import { describe, it, expect } from '@jest/globals'
import { mapLikeToPlain, normalizeMerchantSocialMedia } from '../../../util/merchantSocialMedia.js'

describe('merchantSocialMedia', () => {
	it('normalizes supported platforms and trims values', () => {
		expect(normalizeMerchantSocialMedia({
			facebook: ' https://facebook.com/acme ',
			instagram: 'https://instagram.com/acme',
			tiktok: '',
			twitter: 'https://x.com/acme',
			linkedin: 'https://linkedin.com/company/acme',
			unknown: 'https://example.com'
		})).toEqual({
			facebook: 'https://facebook.com/acme',
			instagram: 'https://instagram.com/acme',
			twitter: 'https://x.com/acme',
			linkedin: 'https://linkedin.com/company/acme'
		})
	})

	it('accepts x as alias for twitter', () => {
		expect(normalizeMerchantSocialMedia({ x: 'https://x.com/acme' })).toEqual({
			twitter: 'https://x.com/acme'
		})
	})

	it('converts map-like socialMedia values to plain objects', () => {
		const map = new Map([['facebook', 'https://facebook.com/acme']])
		expect(mapLikeToPlain(map)).toEqual({ facebook: 'https://facebook.com/acme' })
	})
})
