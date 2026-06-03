import { describe, it, expect } from '@jest/globals'
import {
	validateBusinessLandingConfig,
	mergeBusinessLandingBeforeValidate,
	canMutateBusinessLanding,
	prepareIncomingOtherInfoForCreate,
} from '../../../util/businessLanding.js'
import * as consts from '../../../const.js'

describe('businessLanding util', () => {
	it('validateBusinessLandingConfig accepts minimal doc', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			hero: { title: 'Okazzo for venues', primaryCtaUrl: 'https://okazzo.eu' },
		})
		expect(v.ok).toBe(true)
		expect(v.normalized.version).toBe(1)
		expect(v.normalized.hero.title).toBe('Okazzo for venues')
	})

	it('validateBusinessLandingConfig rejects bad hero URL', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			hero: { primaryCtaUrl: 'javascript:alert(1)' },
		})
		expect(v.ok).toBe(false)
	})

	it('mergeBusinessLandingBeforeValidate keeps organiserVoices when incoming omits them', () => {
		const prev = {
			version: 1,
			hero: { title: 'Old title' },
			organiserVoices: {
				items: [{ quote: 'CMS quote stays', author: 'A', role: 'B' }],
			},
		}
		const incoming = {
			version: 1,
			hero: { title: 'New title' },
		}
		const merged = mergeBusinessLandingBeforeValidate(prev, incoming)
		expect(merged.hero.title).toBe('New title')
		expect(merged.organiserVoices.items[0].quote).toBe('CMS quote stays')
	})

	it('validateBusinessLandingConfig accepts organiserVoices block', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			organiserVoices: {
				eyebrow: 'Organiser voices',
				title: 'Trusted by teams',
				subtitle: 'What organisers say.',
				items: [{ quote: 'Great platform.', author: 'Promoter', role: 'Live music' }],
			},
		})
		expect(v.ok).toBe(true)
		expect(v.normalized.organiserVoices.items).toHaveLength(1)
		expect(v.normalized.testimonials).toHaveLength(1)
		expect(v.normalized.testimonials[0].quote).toBe('Great platform.')
	})

	it('validateBusinessLandingConfig accepts promoVideo with https URL', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			promoVideo: {
				url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				caption: 'Platform walkthrough',
			},
		})
		expect(v.ok).toBe(true)
		expect(v.normalized.promoVideo.url).toContain('youtube.com')
		expect(v.normalized.promoVideo.caption).toBe('Platform walkthrough')
	})

	it('validateBusinessLandingConfig rejects promoVideo with non-https URL', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			promoVideo: { url: 'http://example.com/a.mp4' },
		})
		expect(v.ok).toBe(false)
		expect(v.errors.some((e) => e.includes('promoVideo'))).toBe(true)
	})

	it('validateBusinessLandingConfig rejects bad promoVideo posterUrl', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			promoVideo: { url: 'https://example.com/a.mp4', posterUrl: 'javascript:alert(1)' },
		})
		expect(v.ok).toBe(false)
	})

	it('validateBusinessLandingConfig rejects unknown top-level keys', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			evil: true,
		})
		expect(v.ok).toBe(false)
	})

	it('canMutateBusinessLanding is admin or superAdmin only', () => {
		expect(canMutateBusinessLanding(consts.ROLE_ADMIN)).toBe(true)
		expect(canMutateBusinessLanding(consts.ROLE_SUPER_ADMIN)).toBe(true)
		expect(canMutateBusinessLanding(consts.ROLE_STAFF)).toBe(false)
		expect(canMutateBusinessLanding(consts.ROLE_MEMBER)).toBe(false)
	})

	it('prepareIncomingOtherInfoForCreate allows staff without businessLanding key', () => {
		const r = prepareIncomingOtherInfoForCreate(consts.ROLE_STAFF, { locales: { fi: {} } })
		expect(r.ok).toBe(true)
		expect(r.otherInfo.locales).toBeDefined()
	})

	it('prepareIncomingOtherInfoForCreate rejects staff with businessLanding', () => {
		const r = prepareIncomingOtherInfoForCreate(consts.ROLE_STAFF, {
			businessLanding: { version: 1 },
		})
		expect(r.ok).toBe(false)
	})

	it('validateBusinessLandingConfig accepts trustAndData with https ctaUrl', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			trustAndData: {
				eyebrow: 'Trust & data',
				title: 'Privacy built in',
				items: [{ title: 'GDPR-style data requests', body: 'Buyers can submit requests from the storefront.' }],
				ctaLabel: 'See buyer data requests',
				ctaUrl: 'https://okazzo.eu/request-data',
			},
		})
		expect(v.ok).toBe(true)
		expect(v.normalized.trustAndData.items).toHaveLength(1)
		expect(v.normalized.trustAndData.ctaUrl).toBe('https://okazzo.eu/request-data')
	})

	it('validateBusinessLandingConfig rejects bad trustAndData ctaUrl', () => {
		const v = validateBusinessLandingConfig({
			version: 1,
			trustAndData: {
				items: [{ title: 'Test', body: 'Body' }],
				ctaUrl: 'javascript:alert(1)',
			},
		})
		expect(v.ok).toBe(false)
		expect(v.errors.some((e) => e.includes('trustAndData'))).toBe(true)
	})

	it('mergeBusinessLandingBeforeValidate keeps trustAndData when incoming omits it', () => {
		const prev = {
			version: 1,
			trustAndData: {
				items: [{ title: 'Kept card', body: 'Kept body' }],
			},
		}
		const incoming = {
			version: 1,
			hero: { title: 'New hero' },
		}
		const merged = mergeBusinessLandingBeforeValidate(prev, incoming)
		expect(merged.hero.title).toBe('New hero')
		expect(merged.trustAndData.items[0].title).toBe('Kept card')
	})
})
