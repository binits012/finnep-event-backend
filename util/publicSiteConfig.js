/**
 * Public storefront host registry + SEO/CSP helpers.
 * Stored under Setting.otherInfo.publicSiteConfig (Mongo Map / plain object).
 */

import { pickDefaultPlatformDoc } from './platformSettings.js'

export const DEFAULT_PUBLIC_SITE_CONFIG = {
	version: 1,
	primaryCanonicalBaseUrl: 'https://okazzo.eu',
	hosts: [
		{ hostname: 'okazzo.com.au', publicBaseUrl: 'https://okazzo.com.au', siteCluster: 'au' },
		{ hostname: 'www.okazzo.com.au', publicBaseUrl: 'https://www.okazzo.com.au', siteCluster: 'au' },
		{ hostname: 'okazzo.eu', publicBaseUrl: 'https://okazzo.eu', siteCluster: 'eu' },
		{ hostname: 'www.okazzo.eu', publicBaseUrl: 'https://www.okazzo.eu', siteCluster: 'eu' },
		{ hostname: 'okazzo.fi', publicBaseUrl: 'https://okazzo.fi', siteCluster: 'eu', market: 'FI' },
		{ hostname: 'www.okazzo.fi', publicBaseUrl: 'https://www.okazzo.fi', siteCluster: 'eu', market: 'FI' },
		{ hostname: 'okazzo.se', publicBaseUrl: 'https://okazzo.se', siteCluster: 'eu' },
		{ hostname: 'www.okazzo.se', publicBaseUrl: 'https://www.okazzo.se', siteCluster: 'eu' },
		{ hostname: 'okazzo.no', publicBaseUrl: 'https://okazzo.no', siteCluster: 'eu' },
		{ hostname: 'www.okazzo.no', publicBaseUrl: 'https://www.okazzo.no', siteCluster: 'eu' },
		{ hostname: 'okazzo.dk', publicBaseUrl: 'https://okazzo.dk', siteCluster: 'eu' },
		{ hostname: 'www.okazzo.dk', publicBaseUrl: 'https://www.okazzo.dk', siteCluster: 'eu' },
		{ hostname: 'business.okazzo.eu', publicBaseUrl: 'https://business.okazzo.eu', siteCluster: 'eu' },
		{ hostname: 'www.business.okazzo.eu', publicBaseUrl: 'https://www.business.okazzo.eu', siteCluster: 'eu' },
		{ hostname: 'business.okazzo.com.au', publicBaseUrl: 'https://business.okazzo.com.au', siteCluster: 'au' },
		{ hostname: 'www.business.okazzo.com.au', publicBaseUrl: 'https://www.business.okazzo.com.au', siteCluster: 'au' },
		{ hostname: 'business.okazzo.fi', publicBaseUrl: 'https://business.okazzo.fi', siteCluster: 'eu', market: 'FI' },
		{ hostname: 'www.business.okazzo.fi', publicBaseUrl: 'https://www.business.okazzo.fi', siteCluster: 'eu', market: 'FI' }
	],
	hreflangAlternates: [
		{ hreflang: 'en-US', publicBaseUrl: 'https://okazzo.com.au' },
		{ hreflang: 'x-default', publicBaseUrl: 'https://okazzo.eu' },
		{ hreflang: 'fi-FI', publicBaseUrl: 'https://okazzo.fi' },
		{ hreflang: 'sv-SE', publicBaseUrl: 'https://okazzo.se' },
		{ hreflang: 'no-NO', publicBaseUrl: 'https://okazzo.no' },
		{ hreflang: 'da-DK', publicBaseUrl: 'https://okazzo.dk' }
	],
	extraCorsOrigins: [
		'https://regional.okazzo.eu',
		'https://www.regional.okazzo.eu',
		'https://business.okazzo.eu',
		'https://www.business.okazzo.eu',
		'https://business.okazzo.com.au',
		'https://www.business.okazzo.com.au',
		'https://business.okazzo.fi',
		'https://www.business.okazzo.fi',
	],
}

function normalizeHostname(raw) {
	if (raw == null || typeof raw !== 'string') return ''
	return String(raw).trim().toLowerCase().split(':')[0].replace(/\.$/, '')
}

function isHttpsUrl(s) {
	if (typeof s !== 'string' || !s.startsWith('https://')) return false
	try {
		const u = new URL(s)
		return u.protocol === 'https:'
	} catch {
		return false
	}
}

function originFromPublicBaseUrl(publicBaseUrl) {
	try {
		const u = new URL(publicBaseUrl)
		return `${u.protocol}//${u.host}`
	} catch {
		return null
	}
}

/**
 * Convert Mongoose Map or plain object to plain object (shallow for otherInfo).
 */
export function otherInfoToPlain(otherInfo) {
	if (!otherInfo) return {}
	if (otherInfo instanceof Map) return Object.fromEntries(otherInfo.entries())
	if (typeof otherInfo === 'object') return { ...otherInfo }
	return {}
}

export function extractPublicSiteConfigFromSettingDoc(settingDoc) {
	if (!settingDoc) return null
	const plain = otherInfoToPlain(settingDoc.otherInfo)
	const raw = plain.publicSiteConfig
	if (!raw || typeof raw !== 'object') return null
	return raw
}

/**
 * @returns {{ ok: true, normalized: object } | { ok: false, errors: string[] }}
 */
export function validatePublicSiteConfig(input) {
	const errors = []
	if (!input || typeof input !== 'object') {
		return { ok: false, errors: ['publicSiteConfig must be an object'] }
	}

	const primary = input.primaryCanonicalBaseUrl
	if (!isHttpsUrl(primary)) {
		errors.push('primaryCanonicalBaseUrl must be a valid https URL')
	}

	const hosts = Array.isArray(input.hosts) ? input.hosts : null
	if (!hosts || hosts.length === 0) {
		errors.push('hosts must be a non-empty array')
	} else {
		const seen = new Set()
		for (let i = 0; i < hosts.length; i++) {
			const h = hosts[i]
			if (!h || typeof h !== 'object') {
				errors.push(`hosts[${i}] must be an object`)
				continue
			}
			const hn = normalizeHostname(h.hostname)
			if (!hn) errors.push(`hosts[${i}].hostname is required`)
			if (seen.has(hn)) errors.push(`duplicate hostname: ${hn}`)
			seen.add(hn)

			if (!isHttpsUrl(h.publicBaseUrl)) {
				errors.push(`hosts[${i}].publicBaseUrl must be https`)
			} else {
				try {
					const hostFromUrl = normalizeHostname(new URL(h.publicBaseUrl).hostname)
					if (hn && hostFromUrl !== hn) {
						errors.push(`hosts[${i}].publicBaseUrl host must match hostname (${hn} vs ${hostFromUrl})`)
					}
				} catch {
					errors.push(`hosts[${i}].publicBaseUrl is invalid`)
				}
			}

			if (h.siteCluster !== 'au' && h.siteCluster !== 'eu') {
				errors.push(`hosts[${i}].siteCluster must be "au" or "eu"`)
			}
		}
	}

	let hreflangAlternates = []
	if (input.hreflangAlternates !== undefined) {
		if (!Array.isArray(input.hreflangAlternates)) {
			errors.push('hreflangAlternates must be an array when set')
		} else {
			const seenH = new Set()
			for (let i = 0; i < input.hreflangAlternates.length; i++) {
				const row = input.hreflangAlternates[i]
				if (!row || typeof row !== 'object') {
					errors.push(`hreflangAlternates[${i}] must be an object`)
					continue
				}
				const tag = String(row.hreflang || '').trim()
				if (!tag) errors.push(`hreflangAlternates[${i}].hreflang is required`)
				if (seenH.has(tag)) errors.push(`duplicate hreflang: ${tag}`)
				seenH.add(tag)
				if (!isHttpsUrl(row.publicBaseUrl)) {
					errors.push(`hreflangAlternates[${i}].publicBaseUrl must be https`)
				}
			}
			hreflangAlternates = input.hreflangAlternates
		}
	}

	const extraCorsOrigins = []
	if (input.extraCorsOrigins !== undefined) {
		if (!Array.isArray(input.extraCorsOrigins)) {
			errors.push('extraCorsOrigins must be an array when set')
		} else {
			for (let i = 0; i < input.extraCorsOrigins.length; i++) {
				const o = input.extraCorsOrigins[i]
				if (typeof o !== 'string' || !o.startsWith('https://')) {
					errors.push(`extraCorsOrigins[${i}] must be an https origin URL`)
					continue
				}
				try {
					const u = new URL(o)
					if (u.pathname !== '/' && u.pathname !== '') {
						errors.push(`extraCorsOrigins[${i}] must be origin only (no path)`)
						continue
					}
					extraCorsOrigins.push(`${u.protocol}//${u.host}`)
				} catch {
					errors.push(`extraCorsOrigins[${i}] is not a valid URL`)
				}
			}
		}
	}

	if (errors.length > 0) return { ok: false, errors }

	const normalized = {
		version: Number(input.version) || 1,
		primaryCanonicalBaseUrl: String(primary).replace(/\/+$/, ''),
		hosts: hosts.map((h) => ({
			hostname: normalizeHostname(h.hostname),
			publicBaseUrl: String(h.publicBaseUrl).replace(/\/+$/, ''),
			siteCluster: h.siteCluster,
			...(h.market != null && String(h.market).trim() !== ''
				? { market: String(h.market).trim().toUpperCase() }
				: {})
		})),
		hreflangAlternates: Array.isArray(hreflangAlternates)
			? hreflangAlternates.map((row) => ({
					hreflang: String(row.hreflang).trim(),
					publicBaseUrl: String(row.publicBaseUrl).replace(/\/+$/, '')
				}))
			: [],
		extraCorsOrigins: [...new Set(extraCorsOrigins)]
	}

	return { ok: true, normalized }
}

/** Match incoming request host to a CMS publicSiteConfig host row. */
export function resolveHostEntry(requestHost, hosts) {
	const hn = normalizeHostname(requestHost)
	if (!hn || !Array.isArray(hosts)) return null
	return hosts.find((h) => h && normalizeHostname(h.hostname) === hn) ?? null
}

export function mergePublicSiteConfigWithDefaults(raw) {
	const extracted = raw && typeof raw === 'object' ? raw : null
	if (!extracted) return { ...DEFAULT_PUBLIC_SITE_CONFIG }
	const merged = {
		...DEFAULT_PUBLIC_SITE_CONFIG,
		...extracted,
		hosts: Array.isArray(extracted.hosts) && extracted.hosts.length > 0 ? extracted.hosts : DEFAULT_PUBLIC_SITE_CONFIG.hosts,
		hreflangAlternates:
			Array.isArray(extracted.hreflangAlternates) && extracted.hreflangAlternates.length > 0
				? extracted.hreflangAlternates
				: DEFAULT_PUBLIC_SITE_CONFIG.hreflangAlternates,
		extraCorsOrigins: [
			...new Set([
				...(DEFAULT_PUBLIC_SITE_CONFIG.extraCorsOrigins || []),
				...(Array.isArray(extracted.extraCorsOrigins) ? extracted.extraCorsOrigins : []),
			]),
		],
	}
	return merged
}

/**
 * Build slim API payload + derived CORS/CSP origin lists.
 * @param {object|object[]} settingArrayOrDoc — DB row(s); default row is chosen when an array
 * @param {object|null|undefined} mergedOtherInfo — optional merged otherInfo (market overlay) for publicSiteConfig
 */
export function buildPublicSiteConfigPayload(settingArrayOrDoc, mergedOtherInfo = null) {
	const firstDoc = Array.isArray(settingArrayOrDoc)
		? pickDefaultPlatformDoc(settingArrayOrDoc) || settingArrayOrDoc[0]
		: settingArrayOrDoc
	const docForConfig =
		mergedOtherInfo != null && typeof mergedOtherInfo === 'object'
			? { otherInfo: mergedOtherInfo }
			: firstDoc
	const raw = extractPublicSiteConfigFromSettingDoc(docForConfig)
	const effective = mergePublicSiteConfigWithDefaults(raw)
	const v = validatePublicSiteConfig(effective)
	const config = v.ok ? v.normalized : DEFAULT_PUBLIC_SITE_CONFIG

	const cspManifestOrigins = []
	const corsFromHosts = new Set()
	for (const h of config.hosts) {
		const o = originFromPublicBaseUrl(h.publicBaseUrl)
		if (o) {
			cspManifestOrigins.push(o)
			corsFromHosts.add(o)
		}
	}
	for (const o of config.extraCorsOrigins || []) {
		corsFromHosts.add(o)
	}

	const updatedAt =
		firstDoc && firstDoc.updatedAt instanceof Date
			? firstDoc.updatedAt.toISOString()
			: firstDoc && firstDoc.createdAt instanceof Date
				? firstDoc.createdAt.toISOString()
				: new Date().toISOString()

	return {
		updatedAt,
		primaryCanonicalBaseUrl: config.primaryCanonicalBaseUrl,
		hosts: config.hosts,
		hreflangAlternates: config.hreflangAlternates,
		cspManifestOrigins: [...new Set(cspManifestOrigins)],
		corsOriginsFromConfig: [...corsFromHosts]
	}
}
