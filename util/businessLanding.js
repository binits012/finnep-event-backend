/**
 * Structured B2B marketing payload under Setting.otherInfo.businessLanding.
 * Validated on write (admin/superAdmin only) and normalized for public GET.
 */

import * as consts from '../const.js'

const MAX_DOC_BYTES = 120000

/** @param {unknown} role */
export function canMutateBusinessLanding(role) {
	return role === consts.ROLE_ADMIN || role === consts.ROLE_SUPER_ADMIN
}

function trimStr(s, max) {
	if (s == null) return ''
	const t = String(s).trim()
	return t.length > max ? t.slice(0, max) : t
}

function isHttpsOrMailtoOrPathUrl(s) {
	if (s == null || s === '') return true
	const t = String(s).trim()
	if (t.startsWith('/')) return t.length <= 2000
	if (t.startsWith('mailto:')) return t.length <= 2000
	try {
		const u = new URL(t)
		return u.protocol === 'https:'
	} catch {
		return false
	}
}

/** HTTPS or same-site path only (no mailto) — for promo video + poster. */
function isHttpsOrPathUrl(s) {
	if (s == null || s === '') return false
	const t = String(s).trim()
	if (t.startsWith('/')) return t.length <= 2000 && !t.startsWith('//')
	try {
		const u = new URL(t)
		return u.protocol === 'https:'
	} catch {
		return false
	}
}

function normalizeHero(h) {
	if (!h || typeof h !== 'object' || Array.isArray(h)) return { ok: true, value: {} }
	const out = {}
	const title = trimStr(h.title, 500)
	const subtitle = trimStr(h.subtitle, 1000)
	const primaryCta = trimStr(h.primaryCta, 200)
	const primaryCtaUrl = trimStr(h.primaryCtaUrl, 2000)
	if (title) out.title = title
	if (subtitle) out.subtitle = subtitle
	if (primaryCta) out.primaryCta = primaryCta
	if (primaryCtaUrl) {
		if (!isHttpsOrMailtoOrPathUrl(primaryCtaUrl)) {
			return { ok: false, error: 'hero.primaryCtaUrl must be https, mailto:, or a path' }
		}
		out.primaryCtaUrl = primaryCtaUrl
	}
	return { ok: true, value: out }
}

function normalizeStringArray(items, maxItems, maxLenEach) {
	if (!Array.isArray(items)) return []
	const out = []
	for (let i = 0; i < items.length && out.length < maxItems; i++) {
		const s = trimStr(items[i], maxLenEach)
		if (s) out.push(s)
	}
	return out
}

function normalizeFeatures(arr) {
	if (!Array.isArray(arr)) return []
	const out = []
	for (let i = 0; i < arr.length && out.length < 24; i++) {
		const row = arr[i]
		if (!row || typeof row !== 'object' || Array.isArray(row)) continue
		const title = trimStr(row.title, 200)
		const body = trimStr(row.body, 4000)
		if (!title && !body) continue
		out.push({ title, body })
	}
	return out
}

function normalizeLogoStrip(arr) {
	if (!Array.isArray(arr)) return []
	const out = []
	for (let i = 0; i < arr.length && out.length < 40; i++) {
		const row = arr[i]
		if (!row || typeof row !== 'object' || Array.isArray(row)) continue
		const alt = trimStr(row.alt, 160)
		const src = trimStr(row.src, 2000)
		if (!src) continue
		if (!isHttpsOrMailtoOrPathUrl(src)) continue
		out.push({ alt, src })
	}
	return out
}

function normalizeStats(arr) {
	if (!Array.isArray(arr)) return []
	const out = []
	for (let i = 0; i < arr.length && out.length < 12; i++) {
		const row = arr[i]
		if (!row || typeof row !== 'object' || Array.isArray(row)) continue
		const label = trimStr(row.label, 120)
		const value = trimStr(row.value, 120)
		if (!label && !value) continue
		out.push({ label, value })
	}
	return out
}

function normalizeTestimonials(arr) {
	if (!Array.isArray(arr)) return []
	const out = []
	for (let i = 0; i < arr.length && out.length < 20; i++) {
		const row = arr[i]
		if (!row || typeof row !== 'object' || Array.isArray(row)) continue
		const quote = trimStr(row.quote ?? row.text, 2000)
		const author = trimStr(row.author, 200)
		const role = trimStr(row.role, 200)
		const logoUrl = trimStr(row.logoUrl ?? row.iconUrl, 2000)
		if (!quote) continue
		const item = { quote, author, role }
		if (logoUrl && isHttpsOrMailtoOrPathUrl(logoUrl)) item.logoUrl = logoUrl
		out.push(item)
	}
	return out
}

function normalizeFaq(arr) {
	if (!Array.isArray(arr)) return []
	const out = []
	for (let i = 0; i < arr.length && out.length < 40; i++) {
		const row = arr[i]
		if (!row || typeof row !== 'object' || Array.isArray(row)) continue
		const q = trimStr(row.q, 600)
		const a = trimStr(row.a, 8000)
		if (!q && !a) continue
		out.push({ q, a })
	}
	return out
}

function normalizeSeo(seo) {
	if (!seo || typeof seo !== 'object' || Array.isArray(seo)) return {}
	const title = trimStr(seo.title, 200)
	const description = trimStr(seo.description, 500)
	const out = {}
	if (title) out.title = title
	if (description) out.description = description
	return out
}

/** @returns {object|null} */
function normalizeHowItWorks(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const eyebrow = trimStr(input.eyebrow, 120)
	const title = trimStr(input.title, 200)
	const subtitle = trimStr(input.subtitle, 500)
	const steps = []
	if (Array.isArray(input.steps)) {
		for (let i = 0; i < input.steps.length && steps.length < 6; i++) {
			const row = input.steps[i]
			if (!row || typeof row !== 'object' || Array.isArray(row)) continue
			const st = trimStr(row.title, 160)
			const sb = trimStr(row.body, 800)
			if (!st && !sb) continue
			steps.push({ title: st, body: sb })
		}
	}
	if (!steps.length) return null
	const out = { steps }
	if (eyebrow) out.eyebrow = eyebrow
	if (title) out.title = title
	if (subtitle) out.subtitle = subtitle
	return out
}

/** @returns {{ ok: true, value: object|null } | { ok: false, error: string }} */
function normalizeTrustAndData(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: true, value: null }
	const eyebrow = trimStr(input.eyebrow, 120)
	const title = trimStr(input.title, 200)
	const subtitle = trimStr(input.subtitle, 500)
	const items = normalizeFeatures(input.items)
	const ctaLabel = trimStr(input.ctaLabel, 120)
	const ctaUrl = trimStr(input.ctaUrl, 2000)
	if (ctaUrl && !isHttpsOrMailtoOrPathUrl(ctaUrl)) {
		return { ok: false, error: 'trustAndData.ctaUrl must be https, mailto:, or a path' }
	}
	if (!items.length) return { ok: true, value: null }
	const out = { items }
	if (eyebrow) out.eyebrow = eyebrow
	if (title) out.title = title
	if (subtitle) out.subtitle = subtitle
	if (ctaLabel) out.ctaLabel = ctaLabel
	if (ctaUrl) out.ctaUrl = ctaUrl
	return { ok: true, value: out }
}

/** @returns {object|null} */
function normalizeOrganiserVoices(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const eyebrow = trimStr(input.eyebrow, 120)
	const title = trimStr(input.title, 200)
	const subtitle = trimStr(input.subtitle, 500)
	const items = normalizeTestimonials(input.items)
	if (!items.length) return null
	const out = { items }
	if (eyebrow) out.eyebrow = eyebrow
	if (title) out.title = title
	if (subtitle) out.subtitle = subtitle
	return out
}

/** @returns {{ ok: true, value: object|null } | { ok: false, error: string }} */
function normalizeForOrganisers(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: true, value: null }
	const eyebrow = trimStr(input.eyebrow, 120)
	const title = trimStr(input.title, 200)
	const titleEmphasis = trimStr(input.titleEmphasis, 80)
	const body = trimStr(input.body, 1600)
	const bullets = normalizeStringArray(input.bullets, 10, 220)
	const ctaLabel = trimStr(input.ctaLabel, 120)
	const ctaUrl = trimStr(input.ctaUrl, 2000)
	if (ctaUrl && !isHttpsOrMailtoOrPathUrl(ctaUrl)) {
		return { ok: false, error: 'forOrganisers.ctaUrl must be https, mailto:, or a path' }
	}
	if (!title && !body && !bullets.length && !ctaLabel) return { ok: true, value: null }
	const out = {}
	if (eyebrow) out.eyebrow = eyebrow
	if (title) out.title = title
	if (titleEmphasis) out.titleEmphasis = titleEmphasis
	if (body) out.body = body
	if (bullets.length) out.bullets = bullets
	if (ctaLabel) out.ctaLabel = ctaLabel
	if (ctaUrl) out.ctaUrl = ctaUrl
	return { ok: true, value: out }
}

/** @returns {object|null} */
function normalizeFooter(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const tagline = trimStr(input.tagline, 400)
	const legal = []
	if (Array.isArray(input.legal)) {
		for (let i = 0; i < input.legal.length && legal.length < 10; i++) {
			const row = input.legal[i]
			if (!row || typeof row !== 'object' || Array.isArray(row)) continue
			const label = trimStr(row.label, 100)
			const href = trimStr(row.href, 2000)
			if (!label || !href) continue
			if (!isHttpsOrMailtoOrPathUrl(href)) continue
			legal.push({ label, href })
		}
	}
	if (!tagline && !legal.length) return null
	const out = {}
	if (tagline) out.tagline = tagline
	if (legal.length) out.legal = legal
	return out
}

/** @returns {{ ok: true, value: object|null } | { ok: false, error: string }} */
function normalizePromoVideo(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: true, value: null }
	const url = trimStr(input.url, 2000)
	if (!url) return { ok: true, value: null }
	if (!isHttpsOrPathUrl(url)) {
		return { ok: false, error: 'promoVideo.url must be https: or a same-site path' }
	}
	const posterUrl = trimStr(input.posterUrl, 2000)
	if (posterUrl && !isHttpsOrPathUrl(posterUrl)) {
		return { ok: false, error: 'promoVideo.posterUrl must be https: or a same-site path' }
	}
	const caption = trimStr(input.caption, 280)
	const out = { url }
	if (posterUrl) out.posterUrl = posterUrl
	if (caption) out.caption = caption
	return { ok: true, value: out }
}

/**
 * Deep-merge partial CMS updates into stored businessLanding so saving hero-only
 * JSON does not wipe organiserVoices, faq, and other sections.
 * @param {unknown} prev
 * @param {unknown} incoming
 * @returns {object}
 */
export function mergeBusinessLandingBeforeValidate(prev, incoming) {
	const p = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}
	const i = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
	const out = { ...p, ...i }

	if (i.hero && typeof i.hero === 'object' && !Array.isArray(i.hero)) {
		out.hero = { ...(p.hero && typeof p.hero === 'object' ? p.hero : {}), ...i.hero }
	}
	if (i.seo && typeof i.seo === 'object' && !Array.isArray(i.seo)) {
		out.seo = { ...(p.seo && typeof p.seo === 'object' ? p.seo : {}), ...i.seo }
	}

	const incOv = i.organiserVoices ?? i.organizerVoices
	const prevOv = p.organiserVoices ?? p.organizerVoices
	if (
		incOv &&
		typeof incOv === 'object' &&
		!Array.isArray(incOv) &&
		Array.isArray(incOv.items) &&
		incOv.items.length
	) {
		out.organiserVoices = {
			...(prevOv && typeof prevOv === 'object' ? prevOv : {}),
			...incOv,
		}
	} else if (prevOv && typeof prevOv === 'object') {
		out.organiserVoices = prevOv
	}
	delete out.organizerVoices

	if (i.howItWorks && typeof i.howItWorks === 'object' && !Array.isArray(i.howItWorks)) {
		const prevHiw = p.howItWorks && typeof p.howItWorks === 'object' ? p.howItWorks : {}
		const steps =
			Array.isArray(i.howItWorks.steps) && i.howItWorks.steps.length
				? i.howItWorks.steps
				: prevHiw.steps
		out.howItWorks = { ...prevHiw, ...i.howItWorks, ...(steps ? { steps } : {}) }
	}

	if (i.forOrganisers && typeof i.forOrganisers === 'object' && !Array.isArray(i.forOrganisers)) {
		const prevFo = p.forOrganisers && typeof p.forOrganisers === 'object' ? p.forOrganisers : {}
		out.forOrganisers = { ...prevFo, ...i.forOrganisers }
		if (Array.isArray(i.forOrganisers.bullets) && i.forOrganisers.bullets.length) {
			out.forOrganisers.bullets = i.forOrganisers.bullets
		} else if (Array.isArray(prevFo.bullets) && prevFo.bullets.length) {
			out.forOrganisers.bullets = prevFo.bullets
		}
	}

	if (i.trustAndData && typeof i.trustAndData === 'object' && !Array.isArray(i.trustAndData)) {
		const prevTd = p.trustAndData && typeof p.trustAndData === 'object' ? p.trustAndData : {}
		const items =
			Array.isArray(i.trustAndData.items) && i.trustAndData.items.length
				? i.trustAndData.items
				: prevTd.items
		out.trustAndData = { ...prevTd, ...i.trustAndData, ...(items ? { items } : {}) }
	} else if (p.trustAndData && typeof p.trustAndData === 'object') {
		out.trustAndData = p.trustAndData
	}

	for (const k of ['highlights', 'features', 'faq', 'logoStrip', 'stats', 'testimonials']) {
		if (Array.isArray(i[k]) && i[k].length) out[k] = i[k]
		else if (Array.isArray(p[k]) && p[k].length) out[k] = p[k]
	}

	if (i.footer && typeof i.footer === 'object' && !Array.isArray(i.footer)) {
		out.footer = { ...(p.footer && typeof p.footer === 'object' ? p.footer : {}), ...i.footer }
	}
	if (Object.prototype.hasOwnProperty.call(i, 'promoVideo')) {
		out.promoVideo = i.promoVideo
	}

	const version = Number(i.version)
	if (Number.isFinite(version) && version >= 1) out.version = Math.floor(version)
	else if (!Number.isFinite(Number(out.version)) || Number(out.version) < 1) {
		out.version = Number(p.version) >= 1 ? Math.floor(Number(p.version)) : 1
	}

	return out
}

/**
 * @param {unknown} input
 * @returns {{ ok: true, normalized: object|null } | { ok: false, errors: string[] }}
 */
export function validateBusinessLandingConfig(input) {
	const errors = []
	if (input === null || input === undefined) {
		return { ok: true, normalized: null }
	}
	if (typeof input !== 'object' || Array.isArray(input)) {
		return { ok: false, errors: ['businessLanding must be an object or null'] }
	}

	try {
		const sz = JSON.stringify(input).length
		if (sz > MAX_DOC_BYTES) {
			errors.push(`businessLanding JSON exceeds ${MAX_DOC_BYTES} bytes`)
		}
	} catch {
		errors.push('businessLanding is not serializable JSON')
	}

	const version = Number(input.version)
	if (!Number.isFinite(version) || version < 1) {
		errors.push('businessLanding.version must be a number >= 1')
	}

	const heroRaw = normalizeHero(input.hero)
	if (!heroRaw.ok) errors.push(heroRaw.error)

	const forOrgRaw = normalizeForOrganisers(input.forOrganisers)
	if (!forOrgRaw.ok) errors.push(forOrgRaw.error)

	const promoVideoRaw = normalizePromoVideo(input.promoVideo)
	if (!promoVideoRaw.ok) errors.push(promoVideoRaw.error)

	const trustAndDataRaw = normalizeTrustAndData(input.trustAndData)
	if (!trustAndDataRaw.ok) errors.push(trustAndDataRaw.error)

	const unknown = Object.keys(input).filter(
		(k) =>
			![
				'version',
				'hero',
				'features',
				'logoStrip',
				'stats',
				'testimonials',
				'faq',
				'seo',
				'highlights',
				'howItWorks',
				'organiserVoices',
				'organizerVoices',
				'forOrganisers',
				'footer',
				'promoVideo',
				'trustAndData',
			].includes(k)
	)
	if (unknown.length) {
		errors.push(`unknown businessLanding keys: ${unknown.slice(0, 8).join(', ')}`)
	}

	const highlights = normalizeStringArray(input.highlights, 16, 400)

	if (errors.length) return { ok: false, errors }

	const howItWorks = normalizeHowItWorks(input.howItWorks)
	const organiserVoices = normalizeOrganiserVoices(
		input.organiserVoices ?? input.organizerVoices,
	)
	const legacyTestimonials = normalizeTestimonials(input.testimonials)
	const footer = normalizeFooter(input.footer)

	const normalized = {
		version: Math.floor(version) || 1,
		hero: heroRaw.ok ? heroRaw.value : {},
		features: normalizeFeatures(input.features),
		logoStrip: normalizeLogoStrip(input.logoStrip),
		stats: normalizeStats(input.stats),
		testimonials: organiserVoices?.items?.length ? organiserVoices.items : legacyTestimonials,
		faq: normalizeFaq(input.faq),
		seo: normalizeSeo(input.seo),
		highlights,
	}

	if (howItWorks) normalized.howItWorks = howItWorks
	if (organiserVoices) normalized.organiserVoices = organiserVoices
	if (forOrgRaw.ok && forOrgRaw.value) normalized.forOrganisers = forOrgRaw.value
	if (footer) normalized.footer = footer
	if (promoVideoRaw.ok && promoVideoRaw.value) normalized.promoVideo = promoVideoRaw.value
	if (trustAndDataRaw.ok && trustAndDataRaw.value?.items?.length) {
		normalized.trustAndData = trustAndDataRaw.value
	}

	return { ok: true, normalized }
}

/**
 * @param {string} role
 * @param {unknown} otherInfo
 * @returns {{ ok: true, otherInfo: object|null } | { ok: false, status: number, body: object }}
 */
export function prepareIncomingOtherInfoForCreate(role, otherInfo) {
	if (otherInfo == null) return { ok: true, otherInfo: null }
	if (Array.isArray(otherInfo)) {
		return {
			ok: false,
			status: consts.HTTP_STATUS_BAD_REQUEST,
			body: { message: 'otherInfo must be a plain object' },
		}
	}
	const incoming =
		otherInfo instanceof Map ? Object.fromEntries(otherInfo.entries()) : { ...otherInfo }
	if (!Object.prototype.hasOwnProperty.call(incoming, 'businessLanding')) {
		return { ok: true, otherInfo: incoming }
	}
	if (!canMutateBusinessLanding(role)) {
		return {
			ok: false,
			status: consts.HTTP_STATUS_SERVICE_FORBIDDEN,
			body: {
				message: 'Only admin or superAdmin may set businessLanding',
				error: 'INSUFFICIENT_ROLE',
			},
		}
	}
	const v = validateBusinessLandingConfig(incoming.businessLanding)
	if (!v.ok) {
		return {
			ok: false,
			status: consts.HTTP_STATUS_BAD_REQUEST,
			body: { message: 'Invalid businessLanding', errors: v.errors },
		}
	}
	return {
		ok: true,
		otherInfo: { ...incoming, businessLanding: v.normalized },
	}
}
