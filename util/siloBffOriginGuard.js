/** Header CloudFront adds on origin requests only — never forwarded from the browser viewer. */
export const SILO_CF_ATTESTATION_HEADER = 'x-silo-cf-attestation'

export function getSiloBffOriginSecret() {
	return String(process.env.SILO_BFF_ORIGIN_SECRET || '').trim()
}

export function isSiloBffPublicAccessAllowed() {
	if (process.env.SILO_BFF_ALLOW_PUBLIC_ACCESS === 'true') return true
	if (process.env.NODE_ENV === 'development') return true
	return false
}

export function hasValidSiloCfAttestation(req) {
	const secret = getSiloBffOriginSecret()
	if (!secret) return false
	const provided = String(req.headers[SILO_CF_ATTESTATION_HEADER] || '').trim()
	return provided.length > 0 && provided === secret
}

export function isSiloBffOriginEnforcementEnabled() {
	return Boolean(getSiloBffOriginSecret())
}

export function assertSiloBffOriginAllowed(req) {
	if (!isSiloBffOriginEnforcementEnabled()) return
	if (hasValidSiloCfAttestation(req)) return
	if (isSiloBffPublicAccessAllowed()) return
	const err = new Error('Silo storefront BFF is only reachable via CloudFront')
	err.status = 403
	err.code = 'SILO_BFF_ORIGIN_FORBIDDEN'
	throw err
}
