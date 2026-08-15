function cloudfrontBaseUrl() {
	return String(process.env.CLOUDFRONT_URL || '').replace(/\/+$/, '')
}

const S3_ORIGIN_PATTERN = /https?:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com/i

/** True for assets stored on the platform CloudFront / S3 origin. */
export function isPrivateCdnMediaUrl(url) {
	if (!url || typeof url !== 'string') return false
	const trimmed = url.trim()
	if (!trimmed) return false
	const cfBase = cloudfrontBaseUrl()
	if (cfBase && trimmed.startsWith(cfBase)) return true
	return S3_ORIGIN_PATTERN.test(trimmed)
}

function stripCloudFrontSignatureQuery(url) {
	try {
		const parsed = new URL(url)
		if (
			!parsed.searchParams.has('Policy')
			&& !parsed.searchParams.has('Signature')
			&& !parsed.searchParams.has('Key-Pair-Id')
		) {
			return url
		}
		parsed.searchParams.delete('Policy')
		parsed.searchParams.delete('Signature')
		parsed.searchParams.delete('Key-Pair-Id')
		const next = parsed.toString()
		return next.endsWith('?') ? next.slice(0, -1) : next
	} catch {
		return url
	}
}

function normalizePublicCdnUrl(url) {
	const trimmed = url.trim()
	if (!trimmed) return ''

	let normalized = stripCloudFrontSignatureQuery(trimmed)
	const cfBase = cloudfrontBaseUrl()
	if (cfBase && S3_ORIGIN_PATTERN.test(normalized)) {
		normalized = normalized.replace(S3_ORIGIN_PATTERN, cfBase)
	}
	return normalized
}

function galleryUrlBelongsToMerchant(url, merchantId) {
	if (!url || !merchantId) return true
	const match = String(url).match(/\/merchants\/([^/]+)\/gallery\//)
	if (!match) return true
	return String(match[1]) === String(merchantId)
}

/**
 * Resolve platform CDN media for public silo storefront / partner API responses.
 * Objects are served unsigned via CloudFront OAC — do not attach signed-URL query params.
 */
export async function resolvePartnerPublicMediaUrl(url) {
	if (!url || typeof url !== 'string') return ''
	const trimmed = url.trim()
	if (!trimmed) return ''
	if (!isPrivateCdnMediaUrl(trimmed)) return trimmed
	return normalizePublicCdnUrl(trimmed)
}

export async function resolvePartnerThemeMedia(theme, { merchantId } = {}) {
	if (!theme || typeof theme !== 'object') return theme
	const next = { ...theme }
	if (next.brandConfig?.logoUrl) {
		next.brandConfig = {
			...next.brandConfig,
			logoUrl: await resolvePartnerPublicMediaUrl(next.brandConfig.logoUrl)
		}
	}
	if (Array.isArray(next.galleryPhotos) && next.galleryPhotos.length > 0) {
		const resolvedPhotos = await Promise.all(
			next.galleryPhotos.map(async (photo) => {
				if (!photo || typeof photo !== 'object') return photo
				const resolvedUrl = photo.url ? await resolvePartnerPublicMediaUrl(photo.url) : photo.url
				return {
					...photo,
					url: resolvedUrl
				}
			})
		)
		next.galleryPhotos = resolvedPhotos
			.filter(Boolean)
			.filter((photo) => galleryUrlBelongsToMerchant(photo?.url, merchantId))
	}
	if (Array.isArray(next.partners) && next.partners.length > 0) {
		next.partners = await Promise.all(
			next.partners.map(async (partner) => {
				if (!partner || typeof partner !== 'object') return partner
				return {
					...partner,
					logoUrl: partner.logoUrl ? await resolvePartnerPublicMediaUrl(partner.logoUrl) : partner.logoUrl
				}
			})
		)
	}
	return next
}
