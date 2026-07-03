import { getCloudFrontUrl } from './common.js'

function cloudfrontBaseUrl() {
	return String(process.env.CLOUDFRONT_URL || '').replace(/\/+$/, '')
}

/** True for assets stored on the platform private CloudFront / S3 origin. */
export function isPrivateCdnMediaUrl(url) {
	if (!url || typeof url !== 'string') return false
	const trimmed = url.trim()
	if (!trimmed) return false
	const cfBase = cloudfrontBaseUrl()
	if (cfBase && trimmed.startsWith(cfBase)) return true
	return /\.s3\.[^.]+\.amazonaws\.com/i.test(trimmed)
}

/** Sign private CDN URLs for browser use (silo storefront, partner API). */
export async function resolvePartnerPublicMediaUrl(url) {
	if (!url || typeof url !== 'string') return ''
	const trimmed = url.trim()
	if (!trimmed) return ''
	if (!isPrivateCdnMediaUrl(trimmed)) return trimmed
	try {
		return await getCloudFrontUrl(trimmed)
	} catch {
		return trimmed
	}
}

export async function resolvePartnerThemeMedia(theme) {
	if (!theme || typeof theme !== 'object') return theme
	const next = { ...theme }
	if (next.brandConfig?.logoUrl) {
		next.brandConfig = {
			...next.brandConfig,
			logoUrl: await resolvePartnerPublicMediaUrl(next.brandConfig.logoUrl)
		}
	}
	if (Array.isArray(next.galleryPhotos) && next.galleryPhotos.length > 0) {
		next.galleryPhotos = await Promise.all(
			next.galleryPhotos.map(async (photo) => {
				if (!photo || typeof photo !== 'object') return photo
				return {
					...photo,
					url: photo.url ? await resolvePartnerPublicMediaUrl(photo.url) : photo.url
				}
			})
		)
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
