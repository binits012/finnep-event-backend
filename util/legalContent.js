import { resolveMergedPlatformSettings } from './platformSettings.js'
import { normalizeSiloSettings } from './siloSettings.js'
import { hasLegalHtmlContent } from './sanitizeLegalHtml.js'

function escapeHtml(text) {
	if (typeof text !== 'string') return ''
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function listToHtml(items) {
	if (!Array.isArray(items) || items.length === 0) return ''
	const lis = items.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')
	return `<ul>${lis}</ul>`
}

function sectionToHtml(section) {
	if (!section || typeof section !== 'object') return ''
	let html = ''
	if (section.title) html += `<h2>${escapeHtml(section.title)}</h2>`
	if (section.text) html += `<p>${escapeHtml(section.text)}</p>`
	if (section.bullet_points) html += listToHtml(section.bullet_points)
	if (section.prohibitions) html += listToHtml(section.prohibitions)
	if (section.note) {
		html += `<div class="legal-note"><p><strong>Note:</strong> ${escapeHtml(section.note)}</p></div>`
	}
	return html
}

export function sectionsToHtml(sections) {
	if (!sections || typeof sections !== 'object') return ''
	return Object.values(sections).map(sectionToHtml).join('\n')
}

export async function resolvePartnerLegalContent(merchant, countryCode = null) {
	const silo = normalizeSiloSettings(merchant?.siloSettings || {})
	const merchantPrivacy = hasLegalHtmlContent(silo.legal?.privacyPolicyHtml)
		? (silo.legal.privacyPolicyHtml || '').trim()
		: ''
	const merchantTerms = hasLegalHtmlContent(silo.legal?.termsHtml)
		? (silo.legal.termsHtml || '').trim()
		: ''

	let platformPrivacy = ''
	let platformTerms = ''

	if (!merchantPrivacy || !merchantTerms) {
		const { merged } = await resolveMergedPlatformSettings(countryCode)
		const otherInfo = merged?.otherInfo || {}
		if (!merchantPrivacy) {
			platformPrivacy = sectionsToHtml(otherInfo.privacy_policy)
		}
		if (!merchantTerms) {
			platformTerms = sectionsToHtml(otherInfo.terms_and_conditions)
		}
	}

	return {
		privacy: {
			source: merchantPrivacy ? 'merchant' : 'platform',
			html: merchantPrivacy || platformPrivacy
		},
		terms: {
			source: merchantTerms ? 'merchant' : 'platform',
			html: merchantTerms || platformTerms
		}
	}
}
