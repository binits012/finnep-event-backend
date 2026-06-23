import { Merchant as MerchantModel } from '../model/mongoModel.js'
import { normalizeSiloSettings } from './siloSettings.js'
import { decryptSiloSmtpPassword, hasEncryptedSiloSmtpPassword } from './siloSmtpCrypto.js'

const BFF_HEADER = 'x-silo-merchant-id'

/** Nginx on okazzo.* only proxies `/front` and `/api/` to FEB — use this path from browsers. */
export const SILO_STOREFRONT_BFF_PUBLIC_PATH = '/front/silo-storefront-bff'
/** Direct mount for custom origins / CloudFront behaviors that bypass nginx. */
export const SILO_STOREFRONT_BFF_DIRECT_PATH = '/silo-storefront-bff'

function normalizeStorefrontHost(value) {
	if (!value || typeof value !== 'string') return ''
	const trimmed = value.trim().toLowerCase()
	if (!trimmed) return ''
	try {
		const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
		return new URL(withProtocol).hostname
	} catch {
		return trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
	}
}

function extractViewerHost(req) {
	const origin = req.headers.origin || req.headers.referer
	if (origin) {
		try {
			return new URL(origin).hostname.toLowerCase()
		} catch {
			// fall through
		}
	}
	const forwarded = req.headers['x-forwarded-host'] || req.headers.host
	if (!forwarded) return ''
	return String(forwarded).split(',')[0].trim().toLowerCase().replace(/:\d+$/, '')
}

async function findMerchantByStorefrontHost(host) {
	if (!host) return null
	const hostLower = host.toLowerCase()
	return MerchantModel.findOne({
		'siloSettings.enabled': true,
		$or: [
			{ 'siloSettings.deployment.cloudfrontDomainName': hostLower },
			{ 'siloSettings.domain': hostLower },
			{ 'siloSettings.domain': `https://${hostLower}` },
			{ 'siloSettings.domain': `http://${hostLower}` }
		]
	}).lean()
}

export function getSiloStorefrontBffOriginHostname() {
	const raw = (
		process.env.SILO_STOREFRONT_BFF_ORIGIN
		|| process.env.PARTNER_API_PUBLIC_URL
		|| process.env.FQDN
		|| ''
	).trim()
	if (!raw) return ''
	try {
		const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
		return new URL(withProtocol).hostname
	} catch {
		return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
	}
}

export async function resolveSiloBffMerchant(req) {
	let merchantId = String(req.headers[BFF_HEADER] || req.headers['X-Silo-Merchant-Id'] || '').trim()
	let merchant = null

	if (merchantId) {
		merchant = await MerchantModel.findOne({ merchantId }).lean()
	} else {
		const viewerHost = extractViewerHost(req)
		merchant = await findMerchantByStorefrontHost(viewerHost)
		if (merchant) {
			merchantId = String(merchant.merchantId)
		}
	}

	if (!merchantId || !merchant) {
		const err = new Error('Could not resolve silo merchant from storefront origin — set silo domain or CloudFront hostname on the merchant')
		err.status = 400
		err.code = 'MISSING_SILO_MERCHANT'
		throw err
	}

	if (!normalizeSiloSettings(merchant.siloSettings || {}).enabled) {
		const err = new Error('Silo is not enabled')
		err.status = 403
		err.code = 'SILO_NOT_ENABLED'
		throw err
	}

	const credential = (merchant.apiCredentials || []).find(
		(c) => c.status === 'active' && c.serverToServer && hasEncryptedSiloSmtpPassword(c.bffSecret || c.deploySecret)
	)
	if (!credential) {
		const err = new Error('Silo BFF credentials are not configured — rotate API credentials in CMS')
		err.status = 503
		err.code = 'SILO_BFF_NOT_CONFIGURED'
		throw err
	}

	return { merchant, credential }
}

function getPartnerBaseUrl() {
	const port = process.env.PORT || 3001
	return `http://127.0.0.1:${port}`
}

export async function partnerFetchForSiloBff(credential, {
	path,
	searchParams = {},
	method = 'GET',
	body
}) {
	const apiSecret = decryptSiloSmtpPassword(credential.bffSecret || credential.deploySecret)
	const url = new URL(`${getPartnerBaseUrl()}${path}`)
	for (const [key, value] of Object.entries(searchParams)) {
		if (value !== undefined && value !== null && value !== '') {
			url.searchParams.set(key, String(value))
		}
	}

	const response = await fetch(url.toString(), {
		method,
		headers: {
			'x-api-key': credential.keyId,
			'x-api-secret': apiSecret,
			Accept: 'application/json',
			...(method !== 'GET' && method !== 'HEAD' ? { 'Content-Type': 'application/json' } : {})
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	})

	const text = await response.text()
	let payload
	try {
		payload = text ? JSON.parse(text) : {}
	} catch {
		payload = { message: text }
	}

	if (!response.ok) {
		const err = new Error(payload?.error || payload?.message || `Partner API ${response.status}`)
		err.status = response.status
		err.body = payload
		throw err
	}

	return payload
}

export async function proxyFebFrontForSiloBff(req, res, pathSuffix) {
	const baseUrl = getPartnerBaseUrl()
	const targetUrl = `${baseUrl}/front/${pathSuffix}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`

	const headers = {
		Accept: req.headers.accept || 'application/json',
	}
	if (req.headers['content-type']) {
		headers['Content-Type'] = req.headers['content-type']
	}
	if (req.headers.authorization) {
		headers.Authorization = req.headers.authorization
	}

	const viewerHost = req.headers['x-forwarded-host'] || req.headers.host
	if (viewerHost) {
		const proto = req.headers['x-forwarded-proto'] || 'https'
		const origin = `${proto}://${String(viewerHost).split(',')[0].trim()}`
		headers.Origin = origin
		headers.Referer = `${origin}/`
	}
	if (req.headers['x-market-country-code']) {
		headers['x-market-country-code'] = req.headers['x-market-country-code']
	}
	if (req.headers['x-country-code']) {
		headers['x-country-code'] = req.headers['x-country-code']
	}

	const response = await fetch(targetUrl, {
		method: req.method,
		headers,
		...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: JSON.stringify(req.body ?? {}) } : {})
	})

	const text = await response.text()
	res.status(response.status)
	res.set('Content-Type', response.headers.get('content-type') || 'application/json')
	res.send(text)
}

export function sendSiloBffError(res, error) {
	const status = error?.status || 500
	res.status(status).json({
		message: error?.message || 'Internal server error',
		error: error?.code || 'SILO_BFF_ERROR',
		...(error?.body && typeof error.body === 'object' ? error.body : {})
	})
}
