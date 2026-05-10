import * as Setting from '../model/setting.js'
import { buildPublicSiteConfigPayload } from './publicSiteConfig.js'

/** Baseline origins — merged with CORS_ORIGINS, FRONTEND_URL, and DB-driven storefront hosts */
export const STATIC_APP_ORIGINS = [
	'https://finnep-eventapp-test.s3.eu-central-1.amazonaws.com',
	'https://d3ibhfrhdk2dm6.cloudfront.net',
	'https://test.okazzo.eu',
	'https://okazzo.com.au',
	'https://www.okazzo.com.au',
	'https://okazzo.eu',
	'https://www.okazzo.eu',
	'https://okazzo.fi',
	'https://www.okazzo.fi',
	'https://okazzo.se',
	'https://www.okazzo.se',
	'https://okazzo.no',
	'https://www.okazzo.no',
	'https://okazzo.dk',
	'https://www.okazzo.dk',
	'http://localhost:3000',
	'http://localhost:3002',
	'http://localhost:3003',
	'http://192.168.1.107:3003'
]

let dynamicCorsOrigins = []

export function getDynamicCorsOrigins() {
	return dynamicCorsOrigins
}

export function getMergedCorsOrigins() {
	const fromEnv = process.env.CORS_ORIGINS
		? process.env.CORS_ORIGINS.split(',').map((url) => url.trim()).filter((url) => url.length > 0)
		: []
	return [
		...new Set([...STATIC_APP_ORIGINS, ...fromEnv, process.env.FRONTEND_URL, ...dynamicCorsOrigins].filter(Boolean))
	]
}

/**
 * Load Setting from DB and refresh dynamic CORS origins from publicSiteConfig.
 */
export async function refreshCorsOriginsFromDb() {
	try {
		const settings = await Setting.getSetting()
		if (!settings || settings instanceof Error) {
			dynamicCorsOrigins = []
			return
		}
		const payload = buildPublicSiteConfigPayload(settings)
		dynamicCorsOrigins = payload.corsOriginsFromConfig || []
	} catch (e) {
		console.error('[CORS] refreshCorsOriginsFromDb failed:', e.message || e)
		dynamicCorsOrigins = []
	}
}
