import * as consts from '../const.js'

const countryAliases = {
	AE: ['AE', 'UNITED ARAB EMIRATES', 'UAE'],
	AT: ['AT', 'AUSTRIA'],
	AU: ['AU', 'AUSTRALIA'],
	BE: ['BE', 'BELGIUM'],
	BG: ['BG', 'BULGARIA'],
	BR: ['BR', 'BRAZIL'],
	CA: ['CA', 'CANADA'],
	CH: ['CH', 'SWITZERLAND'],
	CY: ['CY', 'CYPRUS'],
	CZ: ['CZ', 'CZECH REPUBLIC', 'CZECHIA'],
	DE: ['DE', 'GERMANY'],
	DK: ['DK', 'DENMARK'],
	EE: ['EE', 'ESTONIA'],
	ES: ['ES', 'SPAIN'],
	FI: ['FI', 'FINLAND'],
	FR: ['FR', 'FRANCE'],
	GB: ['GB', 'UNITED KINGDOM', 'UK', 'GREAT BRITAIN'],
	GI: ['GI', 'GIBRALTAR'],
	GR: ['GR', 'GREECE'],
	HK: ['HK', 'HONG KONG'],
	HR: ['HR', 'CROATIA'],
	HU: ['HU', 'HUNGARY'],
	ID: ['ID', 'INDONESIA'],
	IE: ['IE', 'IRELAND'],
	IN: ['IN', 'INDIA'],
	IT: ['IT', 'ITALY'],
	JP: ['JP', 'JAPAN'],
	LI: ['LI', 'LIECHTENSTEIN'],
	LT: ['LT', 'LITHUANIA'],
	LU: ['LU', 'LUXEMBOURG'],
	LV: ['LV', 'LATVIA'],
	MT: ['MT', 'MALTA'],
	MX: ['MX', 'MEXICO'],
	MY: ['MY', 'MALAYSIA'],
	NL: ['NL', 'NETHERLANDS'],
	NO: ['NO', 'NORWAY'],
	NZ: ['NZ', 'NEW ZEALAND'],
	PL: ['PL', 'POLAND'],
	PT: ['PT', 'PORTUGAL'],
	RO: ['RO', 'ROMANIA'],
	SE: ['SE', 'SWEDEN'],
	SG: ['SG', 'SINGAPORE'],
	SI: ['SI', 'SLOVENIA'],
	SK: ['SK', 'SLOVAKIA'],
	TH: ['TH', 'THAILAND'],
	US: ['US', 'UNITED STATES', 'USA', 'UNITED STATES OF AMERICA']
}

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const normalizeCountryCode = (country) => {
	if (!country) return ''
	const normalized = String(country).trim().toUpperCase()
	if (normalized.length === 2) return normalized

	for (const [code, aliases] of Object.entries(countryAliases)) {
		if (aliases.includes(normalized)) return code
	}

	return normalized
}

export const normalizeCountryCodes = (countries = []) => {
	if (!Array.isArray(countries)) return []
	return [...new Set(countries.map(normalizeCountryCode).filter(Boolean))]
}

export const buildAccessClaims = (user) => {
	const role = user?.role?.roleType || user?.role
	const scopeType = user?.scopeType || consts.ACCESS_SCOPE_GLOBAL

	if (role === consts.ROLE_SUPER_ADMIN ||
		(scopeType === consts.ACCESS_SCOPE_GLOBAL && role !== consts.ROLE_REGIONAL_OPS)) {
		return {
			scopeType: consts.ACCESS_SCOPE_GLOBAL,
			allowedCountryCodes: []
		}
	}

	return {
		scopeType: consts.ACCESS_SCOPE_REGIONAL,
		allowedCountryCodes: normalizeCountryCodes(user?.allowedCountryCodes)
	}
}

export const isGlobalAccess = (auth) => {
	if (!auth) return false
	if (auth.role === consts.ROLE_REGIONAL_OPS) return false
	if (!auth.scopeType && auth.role !== consts.ROLE_REGIONAL_OPS) return true
	return auth.role === consts.ROLE_SUPER_ADMIN ||
		auth.scopeType === consts.ACCESS_SCOPE_GLOBAL ||
		auth.allowedCountryCodes?.includes('*')
}

export const getAllowedCountryCodes = (auth) => {
	if (isGlobalAccess(auth)) return []
	return normalizeCountryCodes(auth?.allowedCountryCodes)
}

export const canAccessCountry = (auth, country) => {
	if (isGlobalAccess(auth)) return true
	const normalizedCountry = normalizeCountryCode(country)
	if (!normalizedCountry) return false
	return getAllowedCountryCodes(auth).includes(normalizedCountry)
}

export const canAccessResource = (auth, resource) => {
	const country = resource?.country || resource?.merchant?.country
	return canAccessCountry(auth, country)
}

export const expandCountryAliases = (countries = []) => {
	const normalizedCountries = normalizeCountryCodes(countries)
	const aliases = normalizedCountries.flatMap(country => countryAliases[country] || [country])
	return [...new Set(aliases)]
}

export const buildCountryMatchFilter = (countries = []) => {
	if (Array.isArray(countries) && countries.length === 0) {
		return { $in: [] }
	}

	const aliases = expandCountryAliases(countries)
	if (aliases.length === 0) return null

	return {
		$in: aliases.map(alias => new RegExp(`^${escapeRegExp(alias)}$`, 'i'))
	}
}

export const applyRegionalScopeToFilters = (auth, filters = {}) => {
	if (isGlobalAccess(auth)) return filters
	return {
		...filters,
		allowedCountryCodes: getAllowedCountryCodes(auth)
	}
}

export const sendRegionalForbidden = (res) => {
	return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
		message: 'Sorry, You do not have regional access to this resource.',
		error: 'INSUFFICIENT_REGION_SCOPE'
	})
}
