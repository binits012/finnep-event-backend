export const MERCHANT_SOCIAL_PLATFORMS = [
	{ key: 'facebook', label: 'Facebook' },
	{ key: 'instagram', label: 'Instagram' },
	{ key: 'tiktok', label: 'TikTok' },
	{ key: 'twitter', label: 'X' },
	{ key: 'linkedin', label: 'LinkedIn' }
]

const PLATFORM_KEYS = MERCHANT_SOCIAL_PLATFORMS.map((platform) => platform.key)

export function normalizeMerchantSocialMedia(value = {}) {
	const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	const result = {}

	for (const key of PLATFORM_KEYS) {
		let raw = input[key]
		if (key === 'twitter' && (raw == null || String(raw).trim() === '')) {
			raw = input.x
		}
		if (typeof raw === 'string') {
			const trimmed = raw.trim()
			if (trimmed) result[key] = trimmed
		}
	}

	return result
}

export function mapLikeToPlain(value) {
	if (!value) return {}
	if (value instanceof Map) return Object.fromEntries(value.entries())
	if (typeof value === 'object' && !Array.isArray(value)) return { ...value }
	return {}
}
