import { normalizeSiloSettings } from './siloSettings.js'

function sanitizeCheckoutHostname(raw) {
	if (typeof raw !== 'string') return null
	const t = raw.trim().toLowerCase().slice(0, 253)
	if (!t) return null
	if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(t)) return null
	return t
}

function parseHostnameFromUrlish(raw) {
	if (!raw || typeof raw !== 'string') return null
	const trimmed = raw.trim()
	try {
		const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
		return url.hostname ? url.hostname.toLowerCase() : null
	} catch {
		return null
	}
}

export function extractCheckoutHostname({ req, metadata, fulfillment } = {}) {
	// Snapshot / explicit body hints beat Origin — proxy or API callers may send a misleading Origin.
	const candidates = []
	const fulfillmentHint = sanitizeCheckoutHostname(fulfillment?.checkoutHostname)
	if (fulfillmentHint) candidates.push(fulfillmentHint)
	const bodyHint = sanitizeCheckoutHostname(req?.body?.checkoutHostname)
	if (bodyHint) candidates.push(bodyHint)
	const metadataHint = sanitizeCheckoutHostname(metadata?.checkoutHostname)
	if (metadataHint) candidates.push(metadataHint)
	if (req && typeof req.get === 'function') {
		const fromHeader = parseHostnameFromUrlish(req.get('Origin') || req.get('Referer'))
		if (fromHeader) candidates.push(fromHeader)
	}
	return candidates.find(Boolean) || null
}

export function normalizeSiloDomain(domain) {
	if (!domain || typeof domain !== 'string') return ''
	return domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
}

export function hostnameMatchesSiloDomain(hostname, siloDomain) {
	const h = sanitizeCheckoutHostname(hostname)
	const d = normalizeSiloDomain(siloDomain)
	if (!h || !d) return false
	return h === d || h.endsWith(`.${d}`)
}

export function isLocalSiloDevHostname(hostname) {
	const h = sanitizeCheckoutHostname(hostname)
	return h === 'localhost' || h === '127.0.0.1'
}

function getSiloCheckoutDomains(silo) {
	const domains = []
	if (silo.domain) {
		const custom = normalizeSiloDomain(silo.domain)
		if (custom) domains.push(custom)
	}
	const cloudfront = silo.deployment?.cloudfrontDomainName
	if (typeof cloudfront === 'string' && cloudfront.trim()) {
		const cf = normalizeSiloDomain(cloudfront)
		if (cf) domains.push(cf)
	}
	return [...new Set(domains)]
}

function getMerchantPlain(merchant) {
	return merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
}

/** True when merchant has silo mode enabled (independent of checkout host). */
export function isMerchantSiloEnabled(merchant) {
	const obj = getMerchantPlain(merchant)
	const silo = normalizeSiloSettings(obj?.siloSettings || {})
	return Boolean(silo.enabled)
}

/**
 * True when checkout originated from this merchant's silo storefront
 * (custom domain, CloudFront, or local dev). Controls SMTP + accounting channel.
 */
export function shouldUseSiloTicketEmail(merchant, checkoutHostname) {
	if (!isMerchantSiloEnabled(merchant)) return false

	const hostname = sanitizeCheckoutHostname(checkoutHostname)
	if (!hostname) return false

	if (isLocalSiloDevHostname(hostname)) return true

	const obj = getMerchantPlain(merchant)
	const silo = normalizeSiloSettings(obj?.siloSettings || {})
	const domains = getSiloCheckoutDomains(silo)
	if (domains.length === 0) return false

	return domains.some((domain) => hostnameMatchesSiloDomain(hostname, domain))
}

/**
 * Use silo logo / name / footer branding whenever silo is enabled,
 * including marketplace checkouts for that merchant.
 */
export function shouldUseSiloEmailBranding(merchant) {
	return isMerchantSiloEnabled(merchant)
}

/** Accounting / analytics channel for a checkout origin. */
export function resolveSiloCheckoutChannel(merchant, checkoutHostname) {
	return shouldUseSiloTicketEmail(merchant, checkoutHostname) ? 'silo' : 'marketplace'
}

function buildTicketEmailOptions(merchantDoc, checkoutHostname, marketCountryCode = null) {
	const base = { marketCountryCode: marketCountryCode ?? null }
	if (!merchantDoc) return base

	const useSiloBranding = shouldUseSiloEmailBranding(merchantDoc)
	const siloCheckout = shouldUseSiloTicketEmail(merchantDoc, checkoutHostname)

	if (!useSiloBranding && !siloCheckout) return base

	return {
		...base,
		merchant: merchantDoc,
		useSiloBranding: useSiloBranding || siloCheckout,
		...(checkoutHostname ? { checkoutHostname } : {}),
		...(siloCheckout ? { channel: 'silo' } : {})
	}
}

export async function resolveTicketEmailOptions({ req, merchant, metadata, fulfillment, marketCountryCode }) {
	let merchantDoc = merchant
	if (!merchantDoc && metadata?.merchantId) {
		const Merchant = await import('../model/merchant.js')
		merchantDoc = await Merchant.getMerchantById(metadata.merchantId)
	}
	const checkoutHostname = extractCheckoutHostname({ req, metadata, fulfillment })
	return buildTicketEmailOptions(merchantDoc, checkoutHostname, marketCountryCode)
}

export function buildSiloTicketEmailOptionsFromPaymentData(merchant, paymentData = {}) {
	const checkoutHostname = sanitizeCheckoutHostname(paymentData?.checkoutHostname)
	return buildTicketEmailOptions(merchant, checkoutHostname, null)
}
