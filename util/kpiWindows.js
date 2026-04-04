/** Shared UTC window helpers for monitor + dashboard summaries (aligned with monitor KPIs). */

export function window24h() {
	const end = new Date()
	const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
	return { start, end }
}

/** The 24h window immediately before `start24` (current window start). */
export function windowPrior24h(start24) {
	return {
		start: new Date(start24.getTime() - 24 * 60 * 60 * 1000),
		end: new Date(start24.getTime())
	}
}

export function window7dEnd(end) {
	return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
}

export function windowUpcoming7d(end) {
	const until = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000)
	return { from: end, until }
}

export function hourBuckets24h(start, end) {
	const labels = []
	const keys = []
	let t = new Date(start)
	t.setMinutes(0, 0, 0)
	while (t <= end) {
		keys.push(new Date(t))
		labels.push(`${t.getHours().toString().padStart(2, '0')}:00`)
		t = new Date(t.getTime() + 60 * 60 * 1000)
	}
	if (!labels.length) {
		keys.push(new Date(start))
		labels.push('now')
	}
	return { labels, keys }
}

export function velocityLabel(ratio) {
	if (ratio > 1.25) return 'Hot'
	if (ratio < 0.75) return 'Quiet'
	return 'Normal'
}
