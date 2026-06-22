const ALLOWED_SILO_THEME_PRESETS = new Set([
	'cinematic',
	'gallery',
	'festival',
	'minimal_luxury'
])

import { normalizeSiloLegal } from './sanitizeLegalHtml.js'
import { normalizeSiloEmail } from './siloEmailSettings.js'

const DEFAULT_SILO_SETTINGS = {
	enabled: false,
	domain: '',
	themePreset: 'cinematic',
	brandConfig: {
		primaryColor: '#f5b700',
		darkColor: '#050505',
		logoUrl: '',
		fontProfile: 'editorial',
		heroStyle: 'poster'
	},
	deployment: {
		mode: 'per_merchant',
		status: 'not_configured',
		cloudfrontDistributionId: '',
		cloudfrontDomainName: '',
		s3Bucket: '',
		s3Region: '',
		lastProvisionRequestedAt: '',
		lastProvisionedAt: '',
		lastError: '',
		deployStatus: 'not_deployed',
		lastDeployRequestedAt: '',
		lastDeployedAt: '',
		lastDeployError: ''
	},
	legal: {
		privacyPolicyHtml: '',
		termsHtml: ''
	},
	email: {
		smtp: {
			host: '',
			port: 587,
			secure: false,
			user: '',
			password: { iv: '', encryptedData: '' },
			fromEmail: '',
			fromName: ''
		},
		replyTo: ''
	}
}

function normalizeHexColor(value, fallback) {
	if (typeof value !== 'string') return fallback
	const trimmed = value.trim()
	return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback
}

function normalizeGalleryPhotos(value, fallback = []) {
	const source = Array.isArray(value) ? value : fallback
	return source
		.filter((item) => item && typeof item.url === 'string' && item.url.trim())
		.map((item, index) => ({
			url: item.url.trim(),
			position: Number.isFinite(Number(item.position)) ? Number(item.position) : index + 1,
		}))
		.sort((a, b) => a.position - b.position)
}

export function normalizeSiloSettings(value = {}, existing = {}) {
	const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
	const prev = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
	const brandConfig = settings.brandConfig && typeof settings.brandConfig === 'object' && !Array.isArray(settings.brandConfig)
		? settings.brandConfig
		: {}

	return {
		...DEFAULT_SILO_SETTINGS,
		enabled: settings.enabled !== undefined ? Boolean(settings.enabled) : Boolean(prev.enabled),
		domain: typeof settings.domain === 'string'
			? settings.domain.trim().toLowerCase()
			: (prev.domain || ''),
		themePreset: ALLOWED_SILO_THEME_PRESETS.has(settings.themePreset)
			? settings.themePreset
			: (prev.themePreset || DEFAULT_SILO_SETTINGS.themePreset),
		brandConfig: {
			...DEFAULT_SILO_SETTINGS.brandConfig,
			...(prev.brandConfig || {}),
			primaryColor: normalizeHexColor(
				brandConfig.primaryColor,
				prev.brandConfig?.primaryColor || DEFAULT_SILO_SETTINGS.brandConfig.primaryColor
			),
			darkColor: normalizeHexColor(
				brandConfig.darkColor,
				prev.brandConfig?.darkColor || DEFAULT_SILO_SETTINGS.brandConfig.darkColor
			),
			logoUrl: typeof brandConfig.logoUrl === 'string'
				? brandConfig.logoUrl.trim()
				: (prev.brandConfig?.logoUrl || ''),
			fontProfile: ['editorial', 'modern', 'classic'].includes(brandConfig.fontProfile)
				? brandConfig.fontProfile
				: (prev.brandConfig?.fontProfile || DEFAULT_SILO_SETTINGS.brandConfig.fontProfile),
			heroStyle: ['poster', 'split', 'immersive'].includes(brandConfig.heroStyle)
				? brandConfig.heroStyle
				: (prev.brandConfig?.heroStyle || DEFAULT_SILO_SETTINGS.brandConfig.heroStyle)
		},
		deployment: {
			...DEFAULT_SILO_SETTINGS.deployment,
			...(prev.deployment || {}),
			mode: typeof settings.deployment?.mode === 'string'
				? settings.deployment.mode.trim()
				: (prev.deployment?.mode || DEFAULT_SILO_SETTINGS.deployment.mode),
			status: typeof settings.deployment?.status === 'string'
				? settings.deployment.status.trim()
				: (prev.deployment?.status || DEFAULT_SILO_SETTINGS.deployment.status),
			cloudfrontDistributionId: typeof settings.deployment?.cloudfrontDistributionId === 'string'
				? settings.deployment.cloudfrontDistributionId.trim()
				: (prev.deployment?.cloudfrontDistributionId || ''),
			cloudfrontDomainName: typeof settings.deployment?.cloudfrontDomainName === 'string'
				? settings.deployment.cloudfrontDomainName.trim()
				: (prev.deployment?.cloudfrontDomainName || ''),
			s3Bucket: typeof settings.deployment?.s3Bucket === 'string'
				? settings.deployment.s3Bucket.trim()
				: (prev.deployment?.s3Bucket || ''),
			s3Region: typeof settings.deployment?.s3Region === 'string'
				? settings.deployment.s3Region.trim()
				: (prev.deployment?.s3Region || ''),
			lastProvisionRequestedAt: typeof settings.deployment?.lastProvisionRequestedAt === 'string'
				? settings.deployment.lastProvisionRequestedAt.trim()
				: (prev.deployment?.lastProvisionRequestedAt || ''),
			lastProvisionedAt: typeof settings.deployment?.lastProvisionedAt === 'string'
				? settings.deployment.lastProvisionedAt.trim()
				: (prev.deployment?.lastProvisionedAt || ''),
			lastError: typeof settings.deployment?.lastError === 'string'
				? settings.deployment.lastError.trim()
				: (prev.deployment?.lastError || ''),
			deployStatus: typeof settings.deployment?.deployStatus === 'string'
				? settings.deployment.deployStatus.trim()
				: (prev.deployment?.deployStatus || DEFAULT_SILO_SETTINGS.deployment.deployStatus),
			lastDeployRequestedAt: typeof settings.deployment?.lastDeployRequestedAt === 'string'
				? settings.deployment.lastDeployRequestedAt.trim()
				: (prev.deployment?.lastDeployRequestedAt || ''),
			lastDeployedAt: typeof settings.deployment?.lastDeployedAt === 'string'
				? settings.deployment.lastDeployedAt.trim()
				: (prev.deployment?.lastDeployedAt || ''),
			lastDeployError: typeof settings.deployment?.lastDeployError === 'string'
				? settings.deployment.lastDeployError.trim()
				: (prev.deployment?.lastDeployError || '')
		},
		legal: normalizeSiloLegal(settings.legal !== undefined ? settings.legal : prev.legal),
		email: normalizeSiloEmail(
			settings.email !== undefined ? settings.email : {},
			prev.email || {}
		),
		galleryPhotos: settings.galleryPhotos !== undefined
			? normalizeGalleryPhotos(settings.galleryPhotos)
			: normalizeGalleryPhotos(prev.galleryPhotos)
	}
}

/** EMS → Mongo sync: merchant cannot change `enabled`; only CMS API credentials do. */
export function mergeSiloSettingsFromEmsSync(incoming = {}, existingMongo = {}) {
	const merged = normalizeSiloSettings(incoming, existingMongo)
	merged.enabled = Boolean(existingMongo?.enabled)
	merged.deployment = normalizeSiloSettings({}, existingMongo).deployment
	return merged
}

/** Admin/CMS view of platform-managed silo hosting (FEB Mongo source of truth). */
export function getSiloHostingSummaryForAdmin(siloSettings, apiCredentials = []) {
	const silo = normalizeSiloSettings(siloSettings || {})
	const deployment = silo.deployment || {}
	const activeApiKeyIds = (Array.isArray(apiCredentials) ? apiCredentials : [])
		.filter((credential) => credential?.status === 'active')
		.map((credential) => credential.keyId)
		.filter(Boolean)

	return {
		enabled: silo.enabled,
		activeApiKeyIds,
		deployment: {
			mode: deployment.mode || 'per_merchant',
			status: deployment.status || 'not_configured',
			s3Bucket: deployment.s3Bucket || '',
			s3Region: deployment.s3Region || '',
			cloudfrontDistributionId: deployment.cloudfrontDistributionId || '',
			cloudfrontDomainName: deployment.cloudfrontDomainName || '',
			lastProvisionRequestedAt: deployment.lastProvisionRequestedAt || '',
			lastProvisionedAt: deployment.lastProvisionedAt || '',
			lastError: deployment.lastError || '',
			deployStatus: deployment.deployStatus || 'not_deployed',
			lastDeployRequestedAt: deployment.lastDeployRequestedAt || '',
			lastDeployedAt: deployment.lastDeployedAt || '',
			lastDeployError: deployment.lastDeployError || ''
		}
	}
}

/** Theme payload consumed by silo storefront ThemeRuntime. */
export function toPartnerThemePayload(merchant) {
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const silo = normalizeSiloSettings(obj?.siloSettings || {})
	const logoUrl = silo.brandConfig.logoUrl || obj?.logo || ''

	return {
		themePreset: silo.themePreset,
		brandConfig: {
			...silo.brandConfig,
			logoUrl
		},
		enabled: silo.enabled,
		domain: silo.domain,
		galleryPhotos: silo.enabled ? silo.galleryPhotos : []
	}
}
