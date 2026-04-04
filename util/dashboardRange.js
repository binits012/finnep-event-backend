import { window24h, windowPrior24h } from './kpiWindows.js'

/** Maximum reporting window (days) to bound aggregation cost. */
export const MAX_REPORT_RANGE_DAYS = 400

/**
 * Resolve dashboard report window from query params.
 * - Default (no from/to): rolling last 24h ending now (same as original behaviour).
 * - Custom: `from` and `to` (aliases `start` / `end`) as ISO 8601; both required.
 * Prior comparison window is the immediately preceding interval of equal length: [from - duration, from).
 *
 * @returns {{ ok: true, rangeStart: Date, rangeEnd: Date, priorStart: Date, mode: 'rolling24h'|'custom' } | { ok: false, error: string }}
 */
export function parseDashboardRangeQuery(query) {
	const fromRaw = query?.from ?? query?.start
	const toRaw = query?.to ?? query?.end

	if (fromRaw == null && toRaw == null) {
		const { start: rangeStart, end: rangeEnd } = window24h()
		const { start: priorStart } = windowPrior24h(rangeStart)
		return {
			ok: true,
			rangeStart,
			rangeEnd,
			priorStart,
			mode: 'rolling24h'
		}
	}

	if (fromRaw == null || toRaw == null) {
		return {
			ok: false,
			error: 'Custom range requires both from and to (ISO 8601). Omit both for rolling last 24h.'
		}
	}

	const rangeStart = new Date(fromRaw)
	const rangeEnd = new Date(toRaw)
	if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
		return { ok: false, error: 'Invalid from or to date.' }
	}
	if (rangeStart > rangeEnd) {
		return { ok: false, error: 'from must be before or equal to to.' }
	}

	const durationMs = rangeEnd.getTime() - rangeStart.getTime()
	const maxMs = MAX_REPORT_RANGE_DAYS * 24 * 60 * 60 * 1000
	if (durationMs > maxMs) {
		return {
			ok: false,
			error: `Range too long (maximum ${MAX_REPORT_RANGE_DAYS} days).`
		}
	}

	const priorStart = new Date(rangeStart.getTime() - durationMs)

	return {
		ok: true,
		rangeStart,
		rangeEnd,
		priorStart,
		mode: 'custom'
	}
}

/**
 * @returns {'hour' | 'day'}
 */
export function pulseGranularity(rangeStart, rangeEnd) {
	const ms = rangeEnd.getTime() - rangeStart.getTime()
	const hours = ms / (60 * 60 * 1000)
	if (hours <= 72) return 'hour'
	return 'day'
}

/** UTC calendar days from rangeStart through rangeEnd (for daily pulse buckets). */
export function dayBucketsUtc(rangeStart, rangeEnd) {
	const labels = []
	const keys = []
	let t = new Date(rangeStart)
	t.setUTCHours(0, 0, 0, 0)
	const end = new Date(rangeEnd)
	while (t <= end) {
		keys.push(new Date(t))
		labels.push(t.toISOString().slice(0, 10))
		t = new Date(t.getTime() + 86400000)
	}
	if (!labels.length) {
		keys.push(new Date(rangeStart))
		labels.push(rangeStart.toISOString().slice(0, 10))
	}
	return { labels, keys }
}
