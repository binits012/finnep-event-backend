import { describe, it, expect, beforeAll } from '@jest/globals'
import {
	isPrivateCdnMediaUrl,
	resolvePartnerPublicMediaUrl
} from '../../../util/partnerMediaUrls.js'

describe('partnerMediaUrls', () => {
	beforeAll(() => {
		process.env.CLOUDFRONT_URL = 'https://dpjl2qtfc31de.cloudfront.net'
		process.env.CLOUDFRONT_KEY_PAIR = process.env.CLOUDFRONT_KEY_PAIR || 'K16MG6ZWFDU8L1'
	})

	it('detects private CDN URLs', () => {
		expect(isPrivateCdnMediaUrl('https://dpjl2qtfc31de.cloudfront.net/Other/logo.png')).toBe(true)
		expect(isPrivateCdnMediaUrl('https://okazzo-aus.s3.eu-central-1.amazonaws.com/logo.png')).toBe(true)
		expect(isPrivateCdnMediaUrl('https://example.com/logo.png')).toBe(false)
	})

	it('returns public URLs unchanged', async () => {
		const url = 'https://example.com/logo.png'
		await expect(resolvePartnerPublicMediaUrl(url)).resolves.toBe(url)
	})
})
