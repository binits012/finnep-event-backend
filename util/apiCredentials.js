import crypto from 'crypto'
import { normalizeHostname } from './publicSiteConfig.js'

const DEFAULT_SCOPES = ['events:read', 'merchant:read', 'waitlist:write']
const KEY_PREFIX = 'febk_live_'
const SECRET_PREFIX = 'febs_'

function getPepper() {
	return process.env.API_CREDENTIAL_PEPPER || process.env.JWT_TOKEN_SECRET || 'finnep-api-credential-pepper'
}

export function generateKeyId() {
	return `${KEY_PREFIX}${crypto.randomBytes(16).toString('hex')}`
}

export function generateApiSecret() {
	return `${SECRET_PREFIX}${crypto.randomBytes(32).toString('hex')}`
}

export function hashApiSecret(secret) {
	const salt = crypto.randomBytes(16).toString('hex')
	const hash = crypto.scryptSync(secret, `${salt}:${getPepper()}`, 64).toString('hex')
	return `${salt}:${hash}`
}

export function verifyApiSecret(secret, storedHash) {
	if (!secret || !storedHash || typeof storedHash !== 'string') return false
	const parts = storedHash.split(':')
	if (parts.length !== 2) return false
	const [salt, expectedHash] = parts
	if (!salt || !expectedHash) return false
	try {
		const derived = crypto.scryptSync(secret, `${salt}:${getPepper()}`, 64).toString('hex')
		const a = Buffer.from(expectedHash, 'hex')
		const b = Buffer.from(derived, 'hex')
		if (a.length !== b.length) return false
		return crypto.timingSafeEqual(a, b)
	} catch {
		return false
	}
}

export function normalizeAllowedDomains(domains = []) {
	if (!Array.isArray(domains)) return []
	return [...new Set(
		domains
			.map((d) => normalizeHostname(d))
			.filter(Boolean)
	)]
}

export function domainsToCorsOrigins(domains = []) {
	return normalizeAllowedDomains(domains).map((hostname) => `https://${hostname}`)
}

export function sanitizeCredentialForResponse(credential) {
	if (!credential) return null
	const obj = typeof credential.toObject === 'function' ? credential.toObject() : { ...credential }
	delete obj.secretHash
	delete obj.deploySecret
	delete obj.bffSecret
	return {
		keyId: obj.keyId,
		allowedDomains: obj.allowedDomains || [],
		scopes: obj.scopes || [],
		status: obj.status,
		label: obj.label || '',
		serverToServer: !!obj.serverToServer,
		createdAt: obj.createdAt,
		lastUsedAt: obj.lastUsedAt,
		rotatedAt: obj.rotatedAt
	}
}

function plainOtherInfo(otherInfo) {
	if (!otherInfo) return otherInfo
	if (otherInfo instanceof Map) return Object.fromEntries(otherInfo.entries())
	if (typeof otherInfo === 'object') return { ...otherInfo }
	return otherInfo
}

export function sanitizeMerchantForAdmin(merchant) {
	if (!merchant) return merchant
	const obj = typeof merchant.toObject === 'function'
		? merchant.toObject({ flattenMaps: true })
		: { ...merchant }
	if (obj.otherInfo) {
		obj.otherInfo = plainOtherInfo(obj.otherInfo)
	}
	if (Array.isArray(obj.apiCredentials)) {
		obj.apiCredentials = obj.apiCredentials.map(sanitizeCredentialForResponse)
	}
	return obj
}

export function getDefaultScopes(requestedScopes) {
	if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
		return [...DEFAULT_SCOPES]
	}
	return [...new Set(requestedScopes.map((s) => String(s).trim()).filter(Boolean))]
}

export function extractRequestHost(req) {
	const origin = req.headers.origin
	if (origin) {
		try {
			return normalizeHostname(new URL(origin).hostname)
		} catch {
			return ''
		}
	}
	const referer = req.headers.referer || req.headers.referrer
	if (referer) {
		try {
			return normalizeHostname(new URL(referer).hostname)
		} catch {
			return ''
		}
	}
	return ''
}

export function isDomainAllowed(credential, requestHost) {
	const allowed = normalizeAllowedDomains(credential?.allowedDomains || [])
	if (allowed.length === 0) return false
	if (!requestHost) return !!credential?.serverToServer
	return allowed.includes(normalizeHostname(requestHost))
}
