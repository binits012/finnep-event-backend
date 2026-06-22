import { normalizeSiloSettings } from './siloSettings.js'
import { isSiloSmtpConfigured } from './siloEmailSettings.js'

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

export function extractCheckoutHostname({ req, metadata } = {}) {
	const candidates = []
	if (req && typeof req.get === 'function') {
		const fromHeader = parseHostnameFromUrlish(req.get('Origin') || req.get('Referer'))
		if (fromHeader) candidates.push(fromHeader)
	}
	const bodyHint = sanitizeCheckoutHostname(req?.body?.checkoutHostname)
	if (bodyHint) candidates.push(bodyHint)
	const metadataHint = sanitizeCheckoutHostname(metadata?.checkoutHostname)
	if (metadataHint) candidates.push(metadataHint)
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

export function shouldUseSiloTicketEmail(merchant, checkoutHostname) {
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const silo = normalizeSiloSettings(obj?.siloSettings || {})
	if (!silo.enabled || !isSiloSmtpConfigured(silo.email)) return false
	const hostname = sanitizeCheckoutHostname(checkoutHostname)
	if (!hostname) return false
	if (isLocalSiloDevHostname(hostname)) return true
	if (!silo.domain) return false
	return hostnameMatchesSiloDomain(hostname, silo.domain)
}

export async function resolveTicketEmailOptions({ req, merchant, metadata, marketCountryCode }) {
	const base = {
		marketCountryCode: marketCountryCode ?? null
	}
	let merchantDoc = merchant
	if (!merchantDoc && metadata?.merchantId) {
		const Merchant = await import('../model/merchant.js')
		merchantDoc = await Merchant.getMerchantById(metadata.merchantId)
	}
	if (!merchantDoc) return base

	const checkoutHostname = extractCheckoutHostname({ req, metadata })
	if (!shouldUseSiloTicketEmail(merchantDoc, checkoutHostname)) {
		return base
	}

	return {
		...base,
		channel: 'silo',
		merchant: merchantDoc,
		checkoutHostname
	}
}

export function buildSiloTicketEmailOptionsFromPaymentData(merchant, paymentData = {}) {
	const base = { marketCountryCode: null }
	if (!merchant) return base
	const checkoutHostname = sanitizeCheckoutHostname(paymentData.checkoutHostname)
	if (!shouldUseSiloTicketEmail(merchant, checkoutHostname)) {
		return base
	}
	return {
		...base,
		channel: 'silo',
		merchant,
		checkoutHostname
	}
}
