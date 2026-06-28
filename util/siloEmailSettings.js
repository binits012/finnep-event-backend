import { hasEncryptedSiloSmtpPassword } from './siloSmtpCrypto.js'

const DEFAULT_SMTP = {
	host: '',
	port: 587,
	secure: false,
	user: '',
	password: { iv: '', encryptedData: '' },
	fromEmail: '',
	fromName: ''
}

function normalizePort(value) {
	const port = parseInt(String(value), 10)
	if (!Number.isFinite(port) || port < 1 || port > 65535) return 587
	return port
}

function normalizeEmail(value) {
	if (typeof value !== 'string') return ''
	return value.trim().toLowerCase()
}

export function normalizeSiloEmail(incoming = {}, existing = {}) {
	const inc = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
	const prev = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
	const incSmtp = inc.smtp && typeof inc.smtp === 'object' ? inc.smtp : {}
	const prevSmtp = prev.smtp && typeof prev.smtp === 'object' ? prev.smtp : {}

	const password = hasEncryptedSiloSmtpPassword(incSmtp.password)
		? { iv: incSmtp.password.iv, encryptedData: incSmtp.password.encryptedData }
		: hasEncryptedSiloSmtpPassword(prevSmtp.password)
			? { iv: prevSmtp.password.iv, encryptedData: prevSmtp.password.encryptedData }
			: { iv: '', encryptedData: '' }

	return {
		smtp: {
			host: typeof incSmtp.host === 'string' ? incSmtp.host.trim() : (prevSmtp.host || ''),
			port: incSmtp.port !== undefined ? normalizePort(incSmtp.port) : normalizePort(prevSmtp.port),
			secure: incSmtp.secure !== undefined ? Boolean(incSmtp.secure) : Boolean(prevSmtp.secure),
			user: typeof incSmtp.user === 'string' ? incSmtp.user.trim() : (prevSmtp.user || ''),
			password,
			fromEmail: incSmtp.fromEmail !== undefined
				? normalizeEmail(incSmtp.fromEmail)
				: normalizeEmail(prevSmtp.fromEmail || ''),
			fromName: typeof incSmtp.fromName === 'string'
				? incSmtp.fromName.trim()
				: (prevSmtp.fromName || '')
		},
		replyTo: typeof inc.replyTo === 'string'
			? normalizeEmail(inc.replyTo)
			: normalizeEmail(prev.replyTo || '')
	}
}

/** SMTP auth user; many providers use the same address as fromEmail. */
export function resolveSiloSmtpAuthUser(smtp) {
	if (!smtp || typeof smtp !== 'object') return ''
	const user = typeof smtp.user === 'string' ? smtp.user.trim() : ''
	if (user) return user
	return typeof smtp.fromEmail === 'string' ? smtp.fromEmail.trim().toLowerCase() : ''
}

export function isSiloSmtpConfigured(emailSettings) {
	const smtp = emailSettings?.smtp
	if (!smtp) return false
	return Boolean(
		smtp.host
		&& resolveSiloSmtpAuthUser(smtp)
		&& smtp.fromEmail
		&& hasEncryptedSiloSmtpPassword(smtp.password)
	)
}

/** Remove secrets before Partner API / public responses. */
export function stripSiloEmailSecrets(emailSettings) {
	if (!emailSettings || typeof emailSettings !== 'object') {
		return { smtp: { ...DEFAULT_SMTP }, replyTo: '', configured: false }
	}
	const smtp = emailSettings.smtp || {}
	return {
		replyTo: emailSettings.replyTo || '',
		configured: isSiloSmtpConfigured(emailSettings),
		smtp: {
			host: smtp.host || '',
			port: smtp.port ?? 587,
			secure: Boolean(smtp.secure),
			fromEmail: smtp.fromEmail || '',
			fromName: smtp.fromName || '',
			passwordConfigured: hasEncryptedSiloSmtpPassword(smtp.password)
		}
	}
}

export function resolveSiloEmailBranding(merchant) {
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const silo = obj?.siloSettings || {}
	const email = silo.email || {}
	const smtp = email.smtp || {}
	const brand = silo.brandConfig || {}
	return {
		companyName: smtp.fromName || obj?.orgName || obj?.name || 'Events',
		companyLogo: brand.logoUrl || obj?.logo || '',
		accentColor: brand.primaryColor || '#f5b700',
		brandingContactEmail: email.replyTo || obj?.companyEmail || obj?.email || '',
		replyTo: email.replyTo || obj?.companyEmail || obj?.email || ''
	}
}

export function resolveSiloPublicBaseUrl(merchant) {
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const domain = obj?.siloSettings?.domain
	if (!domain || typeof domain !== 'string') return null
	const trimmed = domain.trim().toLowerCase()
	if (!trimmed) return null
	return `https://${trimmed.replace(/^https?:\/\//, '')}`
}
