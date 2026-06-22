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
