/**
 * Dashboard summary: include= filtering + narrative/attention helpers.
 * Revenue uses paid tickets only (paymentProvider !== 'free'), sum of ticketInfo.totalPrice with ticketInfo.price fallback.
 */

export const SUMMARY_SECTION_KEYS = [
	'exportMeta',
	'revenue',
	'brief',
	'pulse',
	'kpis',
	'paymentMix',
	'admissions',
	'velocityVsBaseline',
	'topEvents',
	'upcoming',
	'attention',
	'dataQuality',
	'spotlight',
	'deltaSince',
	'insights'
]

/** @returns {Set<string>|null} null = all sections */
export function parseIncludeQuery(raw) {
	if (raw == null || String(raw).trim() === '') return null
	const parts = String(raw)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	if (parts.includes('*') || parts.includes('all')) return null
	return new Set(parts)
}

export function filterSummaryPayload(payload, includeSet) {
	if (!includeSet) return payload
	const out = { exportMeta: payload.exportMeta }
	for (const key of SUMMARY_SECTION_KEYS) {
		if (key === 'exportMeta') continue
		if (includeSet.has(key) && payload[key] !== undefined) {
			out[key] = payload[key]
		}
	}
	return out
}

export function roundMoney(n) {
	if (typeof n !== 'number' || Number.isNaN(n)) return 0
	return Math.round(n * 100) / 100
}

export function pctDelta(current, prior) {
	if (prior <= 0) return current > 0 ? 100 : null
	return Math.round(((current - prior) / prior) * 10000) / 100
}

/**
 * @param {object} m
 * @param {number} m.revenue24
 * @param {number} m.revenuePrior24
 * @param {number} m.ticketsIssued24h
 * @param {string} m.velocityLabel
 * @param {string|null} m.topEarnerTitle
 * @param {number} m.admissions24h
 * @param {number} m.stuckSendCount
 */
export function buildBriefFromMetrics(m, opts = {}) {
	const {
		revenue24,
		revenuePrior24,
		ticketsIssued24h,
		velocityLabel: vel,
		topEarnerTitle,
		admissions24h,
		stuckSendCount
	} = m

	const periodLabel = opts.periodLabel || 'last 24h'
	const priorPeriodLabel = opts.priorPeriodLabel || 'prior 24h'
	const admissionsLabel = opts.admissionsLabel || 'last 24h'

	const delta = pctDelta(revenue24, revenuePrior24)
	let headline = ''
	let sentiment = 'neutral'

	const hasRevenueSignal = revenue24 > 0 || revenuePrior24 > 0
	if (hasRevenueSignal) {
		headline = `Gross paid revenue (${periodLabel}): ${revenue24.toFixed(2)} (local currency).`
		if (delta !== null) {
			headline += ` ${delta >= 0 ? '+' : ''}${delta}% vs ${priorPeriodLabel}.`
		}
		if (topEarnerTitle) {
			headline += ` Strongest event: ${topEarnerTitle}.`
		}
		if (delta !== null && delta < -15) sentiment = 'watch'
		else if (delta !== null && delta > 10) sentiment = 'positive'
	} else {
		headline = `${ticketsIssued24h} ticket(s) issued (${periodLabel}); sales velocity is ${vel} vs your 7-day average.`
		if (topEarnerTitle) {
			headline += ` Top volume: ${topEarnerTitle}.`
		}
	}

	const bullets = []
	if (stuckSendCount > 0) {
		bullets.push(
			`${stuckSendCount} ticket(s) still in send pipeline (older than threshold) — can delay delivery.`
		)
	}
	bullets.push(`Admissions scanned (${admissionsLabel}): ${admissions24h}.`)

	return {
		headline,
		bullets,
		sentiment
	}
}

/**
 * Revenue-first ranking: money/conversion risks before hygiene unless critical.
 * @param {object[]} raw
 */
export function sortAttentionItems(raw) {
	return [...raw].sort((a, b) => (b.sortScore || 0) - (a.sortScore || 0))
}
