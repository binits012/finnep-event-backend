/**
 * Fire-and-forget silo pageviews into finnep-geoip-service HTTP ingest
 * (same OpenSearch matrix as Okazzo nginx analytics).
 */

function normalizeClientIp(value) {
	if (!value || typeof value !== 'string') return ''
	let ip = value.trim()
	if (ip.startsWith('::ffff:')) ip = ip.slice(7)
	return ip
}

export function getSiloClientIp(req) {
	const forwardedFor = req.headers['x-forwarded-for']
	if (forwardedFor) {
		const first = normalizeClientIp(String(forwardedFor).split(',')[0])
		if (first) return first
	}
	const realIP = req.headers['x-real-ip']
	if (realIP) return normalizeClientIp(String(realIP))
	return normalizeClientIp(
		req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || ''
	)
}

function normalizePath(rawPath) {
	if (!rawPath || typeof rawPath !== 'string') return '/'
	const trimmed = rawPath.trim()
	if (!trimmed) return '/'
	try {
		if (/^https?:\/\//i.test(trimmed)) {
			const url = new URL(trimmed)
			return `${url.pathname || '/'}${url.search || ''}` || '/'
		}
	} catch {
		/* path */
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function hostFromReq(req) {
	const origin = req.headers.origin || req.headers.referer
	if (origin) {
		try {
			return new URL(origin).hostname.toLowerCase()
		} catch {
			/* fall through */
		}
	}
	const forwarded = req.headers['x-forwarded-host'] || req.headers.host
	if (!forwarded) return ''
	return String(forwarded).split(',')[0].trim().toLowerCase().replace(/:\d+$/, '')
}

function pathFromReferer(req) {
	const referer = req.headers.referer || req.headers.referrer
	if (!referer) return '/'
	try {
		const url = new URL(referer)
		return `${url.pathname || '/'}${url.search || ''}` || '/'
	} catch {
		return '/'
	}
}

/**
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {string} opts.merchantId
 * @param {string} [opts.path]
 * @param {string} [opts.referer]
 */
export function emitSiloPageview({ req, merchantId, path, referer }) {
	const enabled = process.env.SILO_TRAFFIC_ANALYTICS !== 'false'
	if (!enabled) return

	const geoipServiceUrl = (process.env.GEOIP_SERVICE_URL || '').replace(/\/+$/, '')
	const apiKey = process.env.GEOIP_API_KEY
	if (!geoipServiceUrl || !apiKey) {
		return
	}

	const ip = getSiloClientIp(req)
	if (!ip || ip === 'unknown') return

	const host = hostFromReq(req)
	const pagePath = normalizePath(path || pathFromReferer(req) || '/')
	const ua = String(req.headers['user-agent'] || '').trim()
	if (!ua || !merchantId) return

	const payload = {
		ip,
		path: pagePath,
		method: 'GET',
		status: 200,
		bytes_sent: 0,
		user_agent: ua,
		referer: referer || req.headers.referer || '',
		host,
		merchant_id: String(merchantId),
		source_file: host || 'silo',
		channel: 'silo',
		event_time: new Date().toISOString(),
	}

	const timeoutMs = Number.parseInt(process.env.SILO_TRAFFIC_ANALYTICS_TIMEOUT_MS || '1500', 10)

	// Do not await — never block storefront responses on analytics.
	fetch(`${geoipServiceUrl}/api/analytics/ingest`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-API-Key': apiKey,
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 1500),
	}).catch((err) => {
		console.warn('[silo-traffic] ingest failed:', err?.message || err)
	})
}
