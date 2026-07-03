import { describe, it, expect, beforeAll } from '@jest/globals'
import {
	isPrivateCdnMediaUrl,
	resolvePartnerPublicMediaUrl
} from '../../../util/partnerMediaUrls.js'

describe('partnerMediaUrls', () => {
	beforeAll(() => {
		process.env.CLOUDFRONT_URL = 'https://dpjl2qtfc31de.cloudfront.net'
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

	it('returns unsigned CloudFront URLs unchanged', async () => {
		const url = 'https://dpjl2qtfc31de.cloudfront.net/merchants/1/logo/test.webp'
		await expect(resolvePartnerPublicMediaUrl(url)).resolves.toBe(url)
	})

	it('rewrites S3 URLs to the configured CloudFront base', async () => {
		const url = 'https://okazzo-aus.s3.eu-central-1.amazonaws.com/merchants/1/logo/test.webp'
		await expect(resolvePartnerPublicMediaUrl(url)).resolves.toBe(
			'https://dpjl2qtfc31de.cloudfront.net/merchants/1/logo/test.webp'
		)
	})

	it('strips CloudFront signature query params from stored URLs', async () => {
		const url =
			'https://dpjl2qtfc31de.cloudfront.net/merchants/1/logo/test.webp?Policy=abc&Signature=def&Key-Pair-Id=ghi'
		await expect(resolvePartnerPublicMediaUrl(url)).resolves.toBe(
			'https://dpjl2qtfc31de.cloudfront.net/merchants/1/logo/test.webp'
		)
	})
})
