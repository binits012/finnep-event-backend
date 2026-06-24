export const MAX_LEGAL_HTML_LENGTH = 200 * 1024

export function hasLegalHtmlContent(html) {
	if (typeof html !== 'string') return false
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim().length > 0
}

export function sanitizeLegalHtml(html) {
	if (typeof html !== 'string') return ''
	let trimmed = html.trim()
	if (!hasLegalHtmlContent(trimmed)) return ''
	if (trimmed.length > MAX_LEGAL_HTML_LENGTH) {
		trimmed = trimmed.slice(0, MAX_LEGAL_HTML_LENGTH)
	}
	return trimmed
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
		.replace(/\s*on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(/javascript:/gi, '')
}

export function normalizeSiloLegal(value = {}) {
	const legal = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	return {
		privacyPolicyHtml: sanitizeLegalHtml(
			typeof legal.privacyPolicyHtml === 'string' ? legal.privacyPolicyHtml : ''
		),
		termsHtml: sanitizeLegalHtml(typeof legal.termsHtml === 'string' ? legal.termsHtml : '')
	}
}

export const SILO_ANNOUNCEMENT_TYPES = ['marquee', 'popup', 'footer']

const ALLOWED_ANNOUNCEMENT_DISPLAY_TYPES = new Set(SILO_ANNOUNCEMENT_TYPES)

export function normalizeSiloContent(value = {}) {
	const content = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	return {
		aboutHtml: sanitizeLegalHtml(typeof content.aboutHtml === 'string' ? content.aboutHtml : '')
	}
}

export function normalizeSiloAnnouncementSlot(value = {}) {
	const slot = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	return {
		enabled: Boolean(slot.enabled),
		html: sanitizeLegalHtml(typeof slot.html === 'string' ? slot.html : '')
	}
}

/** @deprecated Legacy single announcement — migrated into announcements[displayType]. */
export function normalizeSiloAnnouncement(value = {}) {
	const announcement = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	const displayType = typeof announcement.displayType === 'string'
		? announcement.displayType.trim().toLowerCase()
		: 'marquee'
	return {
		enabled: Boolean(announcement.enabled),
		html: sanitizeLegalHtml(typeof announcement.html === 'string' ? announcement.html : ''),
		displayType: ALLOWED_ANNOUNCEMENT_DISPLAY_TYPES.has(displayType) ? displayType : 'marquee'
	}
}

export function emptySiloAnnouncements() {
	return {
		marquee: { enabled: false, html: '' },
		popup: { enabled: false, html: '' },
		footer: { enabled: false, html: '' }
	}
}

function migrateLegacyAnnouncementToSlots(legacy = {}) {
	const slots = emptySiloAnnouncements()
	const normalized = normalizeSiloAnnouncement(legacy)
	if (!normalized.enabled && !hasLegalHtmlContent(normalized.html)) {
		return slots
	}
	slots[normalized.displayType] = {
		enabled: normalized.enabled,
		html: normalized.html
	}
	return slots
}

export function normalizeSiloAnnouncements(value = {}, existing = {}) {
	const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	const prev = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
	const base = prev.announcements && typeof prev.announcements === 'object'
		? SILO_ANNOUNCEMENT_TYPES.reduce((acc, type) => {
			acc[type] = normalizeSiloAnnouncementSlot(prev.announcements?.[type])
			return acc
		}, emptySiloAnnouncements())
		: migrateLegacyAnnouncementToSlots(prev.announcement)

	const hasIncomingKeys = SILO_ANNOUNCEMENT_TYPES.some((type) =>
		Object.prototype.hasOwnProperty.call(incoming, type)
	)
	if (!hasIncomingKeys) {
		return base
	}

	return SILO_ANNOUNCEMENT_TYPES.reduce((acc, type) => {
		acc[type] = normalizeSiloAnnouncementSlot(
			Object.prototype.hasOwnProperty.call(incoming, type) ? incoming[type] : base[type]
		)
		return acc
	}, emptySiloAnnouncements())
}
