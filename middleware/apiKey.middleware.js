import * as consts from '../const.js'
import * as Merchant from '../model/merchant.js'
import { reconcileSiloProvisionedFromCredentials } from '../model/merchant.js'
import { publishMerchantSiloProvisionedSafe } from '../util/merchantEventPublisher.js'
import {
	verifyApiSecret,
	extractRequestHost,
	isDomainAllowed
} from '../util/apiCredentials.js'
import { checkPartnerRateLimit } from '../util/partnerRateLimit.js'
import { normalizeSiloSettings } from '../util/siloSettings.js'

function readCredentialHeaders(req) {
	const apiKey = req.headers['x-api-key'] || req.headers['x-api_key']
	const apiSecret = req.headers['x-api-secret'] || req.headers['x-api_secret']

	if (apiKey && apiSecret) {
		return { apiKey: String(apiKey).trim(), apiSecret: String(apiSecret).trim() }
	}

	const authHeader = req.headers.authorization
	if (authHeader && authHeader.startsWith('Basic ')) {
		try {
			const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
			const sep = decoded.indexOf(':')
			if (sep > 0) {
				return {
					apiKey: decoded.slice(0, sep).trim(),
					apiSecret: decoded.slice(sep + 1).trim()
				}
			}
		} catch {
			return { apiKey: '', apiSecret: '' }
		}
	}

	return { apiKey: '', apiSecret: '' }
}

export const authenticatePartnerApiKey = async (req, res, next) => {
	try {
		const { apiKey, apiSecret } = readCredentialHeaders(req)
		if (!apiKey || !apiSecret) {
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				message: 'Unauthorized',
				error: 'MISSING_API_CREDENTIALS'
			})
		}

		const merchant = await Merchant.findMerchantByApiKeyId(apiKey)
		if (!merchant) {
			const revokedMerchant = await Merchant.findMerchantByApiKeyIdAnyStatus(apiKey)
			if (revokedMerchant) {
				console.warn('[PARTNER_API] Auth failed', {
					keyId: apiKey,
					reason: 'revoked_or_inactive_key',
					at: new Date().toISOString()
				})
				return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
					message: 'Unauthorized',
					error: 'API_CREDENTIAL_REVOKED'
				})
			}
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				message: 'Unauthorized',
				error: 'INVALID_API_CREDENTIALS'
			})
		}

		const credential = (merchant.apiCredentials || []).find(
			(c) => c.keyId === apiKey && c.status === 'active'
		)
		if (!credential || !verifyApiSecret(apiSecret, credential.secretHash)) {
			console.warn('[PARTNER_API] Auth failed', {
				keyId: apiKey,
				reason: credential ? 'invalid_secret' : 'unknown_or_inactive_key',
				at: new Date().toISOString()
			})
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				message: 'Unauthorized',
				error: credential ? 'INVALID_API_SECRET' : 'INVALID_API_CREDENTIALS'
			})
		}

		if (!normalizeSiloSettings(merchant.siloSettings || {}).enabled) {
			const result = await reconcileSiloProvisionedFromCredentials(merchant._id)
			if (result.changed && result.merchant) {
				await publishMerchantSiloProvisionedSafe({
					merchant: result.merchant,
					siloEnabled: result.siloEnabled,
					updatedBy: 'partner-api-reconcile',
				})
			}
		}

		const requestHost = extractRequestHost(req)
		if (!isDomainAllowed(credential, requestHost)) {
			return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
				message: 'Forbidden: request origin is not on the credential allowlist',
				error: 'DOMAIN_NOT_ALLOWED'
			})
		}

		const rateLimit = await checkPartnerRateLimit(apiKey)
		if (!rateLimit.allowed) {
			res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds || 60))
			return res.status(consts.HTTP_STATUS_TOO_MANY_REQUESTS).json({
				message: 'Too many requests',
				error: 'RATE_LIMIT_EXCEEDED'
			})
		}

		req.partnerMerchant = {
			_id: merchant._id,
			merchantId: merchant.merchantId,
			name: merchant.name,
			scopes: credential.scopes || [],
			keyId: credential.keyId,
			matchedDomain: requestHost || null
		}
		req.partnerCredential = credential

		console.info('[PARTNER_API]', {
			keyId: credential.keyId,
			merchantId: merchant.merchantId,
			path: req.originalUrl,
			matchedDomain: requestHost || 'server-to-server',
			at: new Date().toISOString()
		})

		Merchant.touchApiCredentialLastUsed(merchant._id, credential.keyId).catch(() => {})

		next()
	} catch (err) {
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
			message: 'Internal server error',
			error: 'PARTNER_AUTH_FAILED'
		})
	}
}

export const requirePartnerScope = (scope) => (req, res, next) => {
	if (!req.partnerMerchant) {
		return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
			message: 'Unauthorized',
			error: 'AUTHENTICATION_REQUIRED'
		})
	}

	const scopes = req.partnerMerchant.scopes || []
	if (!scopes.includes(scope)) {
		return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
			message: 'Forbidden: insufficient scope',
			error: 'INSUFFICIENT_SCOPE'
		})
	}

	next()
}
