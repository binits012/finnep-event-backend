import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import mongoose from 'mongoose'
import request from 'supertest'
import getApp from '../../helpers/appHelper.js'
import * as model from '../../../model/mongoModel.js'
import { hashApiSecret } from '../../../util/apiCredentials.js'

describe('Partner API integration', () => {
	let app
	let merchantA
	let merchantB
	let eventA
	let eventB
	const secretA = 'febs_partner_secret_a'
	const secretB = 'febs_partner_secret_b'
	const keyA = 'febk_live_test_merchant_a'
	const keyB = 'febk_live_test_merchant_b'

	beforeAll(async () => {
		app = await getApp()
		await mongoose.connect(process.env.MONGODB_HOST)

		merchantA = await model.Merchant.create({
			merchantId: 'partner-test-a',
			name: 'Partner Merchant A',
			orgName: 'Partner Merchant A Org',
			companyEmail: 'contact@partner-a.example.com',
			companyPhoneNumber: '+358 40 123 4567',
			companyAddress: 'Test Street 1, Helsinki',
			website: 'https://partner-a.example.com',
			socialMedia: {
				facebook: 'https://facebook.com/partner-a',
				instagram: 'https://instagram.com/partner-a',
				linkedin: 'https://linkedin.com/company/partner-a'
			},
			stripeAccount: 'acct_test_a',
			status: 'active',
			siloSettings: {
				enabled: true,
				domain: 'silo-a.example.com',
				themePreset: 'gallery',
				brandConfig: {
					primaryColor: '#d4af37',
					darkColor: '#111827',
					logoUrl: '',
					fontProfile: 'classic',
					heroStyle: 'split'
				},
				deployment: {
					cloudfrontDistributionId: '',
					s3Bucket: ''
				}
			},
			apiCredentials: [{
				keyId: keyA,
				secretHash: hashApiSecret(secretA),
				allowedDomains: ['silo-a.example.com'],
				scopes: ['events:read', 'merchant:read', 'waitlist:write'],
				status: 'active',
				label: 'test'
			}]
		})

		merchantB = await model.Merchant.create({
			merchantId: 'partner-test-b',
			name: 'Partner Merchant B',
			orgName: 'Partner Merchant B Org',
			stripeAccount: 'acct_test_b',
			status: 'active',
			siloSettings: {
				enabled: true,
			},
			apiCredentials: [{
				keyId: keyB,
				secretHash: hashApiSecret(secretB),
				allowedDomains: ['silo-b.example.com'],
				scopes: ['events:read', 'merchant:read'],
				status: 'active',
				label: 'test'
			}]
		})

		const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
		eventA = await model.Event.create({
			eventTitle: 'Partner Event A',
			eventDescription: 'A',
			eventDate: future,
			event_end_date: future,
			active: true,
			merchant: merchantA._id,
			externalMerchantId: 'partner-test-a',
			externalEventId: 'evt-a-1'
		})

		eventB = await model.Event.create({
			eventTitle: 'Partner Event B',
			eventDescription: 'B',
			eventDate: future,
			event_end_date: future,
			active: true,
			merchant: merchantB._id,
			externalMerchantId: 'partner-test-b',
			externalEventId: 'evt-b-1'
		})
	})

	afterAll(async () => {
		if (eventA?._id || eventB?._id) {
			await model.Event.deleteMany({ _id: { $in: [eventA?._id, eventB?._id].filter(Boolean) } })
		}
		if (merchantA?._id || merchantB?._id) {
			await model.Merchant.deleteMany({ _id: { $in: [merchantA?._id, merchantB?._id].filter(Boolean) } })
		}
	})

	it('rejects missing credentials', async () => {
		const response = await request(app)
			.get('/partner/v1/events')
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(401)
		expect(response.body.error).toBe('MISSING_API_CREDENTIALS')
	})

	it('rejects domain not on allowlist', async () => {
		const response = await request(app)
			.get('/partner/v1/events')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://evil.example.com')

		expect(response.status).toBe(403)
		expect(response.body.error).toBe('DOMAIN_NOT_ALLOWED')
	})

	it('lists only merchant A events', async () => {
		const response = await request(app)
			.get('/partner/v1/events')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(200)
		expect(Array.isArray(response.body.items)).toBe(true)
		expect(response.body.items.length).toBe(1)
		expect(response.body.items[0].eventTitle).toBe('Partner Event A')
	})

	it('excludes inactive upcoming events from partner list and detail', async () => {
		const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
		const inactiveEvent = await model.Event.create({
			eventTitle: 'Inactive Partner Event',
			eventDescription: 'Hidden',
			eventDate: future,
			event_end_date: future,
			active: false,
			merchant: merchantA._id,
			externalMerchantId: 'partner-test-a',
			externalEventId: 'evt-a-inactive'
		})

		const listResponse = await request(app)
			.get('/partner/v1/events')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(listResponse.status).toBe(200)
		expect(listResponse.body.items.some((item) => item.eventTitle === 'Inactive Partner Event')).toBe(false)

		const detailResponse = await request(app)
			.get(`/partner/v1/events/${inactiveEvent._id}`)
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(detailResponse.status).toBe(404)

		await model.Event.deleteOne({ _id: inactiveEvent._id })
	})

	it('includes inactive past events in partner list and detail', async () => {
		const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
		const inactivePastEvent = await model.Event.create({
			eventTitle: 'Inactive Past Partner Event',
			eventDescription: 'Archive',
			eventDate: past,
			event_end_date: past,
			active: false,
			merchant: merchantA._id,
			externalMerchantId: 'partner-test-a',
			externalEventId: 'evt-a-inactive-past'
		})

		const listResponse = await request(app)
			.get('/partner/v1/events')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(listResponse.status).toBe(200)
		expect(listResponse.body.items.some((item) => item.eventTitle === 'Inactive Past Partner Event')).toBe(true)

		const detailResponse = await request(app)
			.get(`/partner/v1/events/${inactivePastEvent._id}`)
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(detailResponse.status).toBe(200)
		expect(detailResponse.body.event.eventTitle).toBe('Inactive Past Partner Event')

		await model.Event.deleteOne({ _id: inactivePastEvent._id })
	})

	it('returns 404 for another merchant event id', async () => {
		const response = await request(app)
			.get(`/partner/v1/events/${eventB._id}`)
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(404)
	})

	it('returns merchant profile for bound merchant', async () => {
		const response = await request(app)
			.get('/partner/v1/merchant')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(200)
		expect(response.body.merchant.name).toBe('Partner Merchant A')
		expect(response.body.merchant.email).toBe('contact@partner-a.example.com')
		expect(response.body.merchant.phone).toBe('+358 40 123 4567')
		expect(response.body.merchant.address).toBe('Test Street 1, Helsinki')
		expect(response.body.merchant.website).toBe('https://partner-a.example.com')
		expect(response.body.merchant.socialMedia).toEqual({
			facebook: 'https://facebook.com/partner-a',
			instagram: 'https://instagram.com/partner-a',
			linkedin: 'https://linkedin.com/company/partner-a'
		})
	})

	it('returns silo theme for bound merchant', async () => {
		const response = await request(app)
			.get('/partner/v1/theme')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(200)
		expect(response.body.theme.themePreset).toBe('gallery')
		expect(response.body.theme.brandConfig.primaryColor).toBe('#d4af37')
		expect(response.body.theme.brandConfig.fontProfile).toBe('classic')
		expect(response.body.theme.enabled).toBe(true)
		expect(response.body.theme.domain).toBe('silo-a.example.com')
	})

	it('rejects partner API when silo storefront is not provisioned', async () => {
		await model.Merchant.updateOne(
			{ _id: merchantA._id },
			{
				$set: {
					'apiCredentials.0.status': 'revoked',
					'siloSettings.enabled': false
				}
			}
		)

		const response = await request(app)
			.get('/partner/v1/merchant')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(401)
		expect(response.body.error).toBe('INVALID_API_CREDENTIALS')

		await model.Merchant.updateOne(
			{ _id: merchantA._id },
			{
				$set: {
					'apiCredentials.0.status': 'active',
					'siloSettings.enabled': true
				}
			}
		)
	})

	it('returns platform legal fallback when merchant has no custom HTML', async () => {
		const response = await request(app)
			.get('/partner/v1/legal')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(200)
		expect(response.body.legal.privacy.source).toBe('platform')
		expect(response.body.legal.terms.source).toBe('platform')
		expect(typeof response.body.legal.privacy.html).toBe('string')
		expect(typeof response.body.legal.terms.html).toBe('string')
	})

	it('returns merchant legal HTML when published', async () => {
		await model.Merchant.updateOne(
			{ _id: merchantA._id },
			{
				$set: {
					'siloSettings.legal.privacyPolicyHtml': '<p>Merchant privacy</p>',
					'siloSettings.legal.termsHtml': '<p>Merchant terms</p>'
				}
			}
		)

		const response = await request(app)
			.get('/partner/v1/legal')
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')

		expect(response.status).toBe(200)
		expect(response.body.legal.privacy).toEqual({
			source: 'merchant',
			html: '<p>Merchant privacy</p>'
		})
		expect(response.body.legal.terms).toEqual({
			source: 'merchant',
			html: '<p>Merchant terms</p>'
		})
	})

	it('returns 503 for waitlist send-code when silo SMTP is not configured', async () => {
		await model.Event.updateOne(
			{ _id: eventA._id },
			{ $set: { waitlistConfig: { pre_sale_enabled: true } } }
		)

		const response = await request(app)
			.post(`/partner/v1/events/${eventA._id}/waitlist/send-code`)
			.set('x-api-key', keyA)
			.set('x-api-secret', secretA)
			.set('Origin', 'https://silo-a.example.com')
			.send({ email: 'fan@example.com' })

		expect(response.status).toBe(503)
		expect(response.body.error).toBe('SILO_EMAIL_NOT_CONFIGURED')
	})

	it('rejects waitlist send-code without waitlist:write scope', async () => {
		const response = await request(app)
			.post(`/partner/v1/events/${eventB._id}/waitlist/send-code`)
			.set('x-api-key', keyB)
			.set('x-api-secret', secretB)
			.set('Origin', 'https://silo-b.example.com')
			.send({ email: 'fan@example.com' })

		expect(response.status).toBe(403)
	})
})
