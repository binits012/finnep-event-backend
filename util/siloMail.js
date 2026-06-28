import path from 'path'
import { fileURLToPath } from 'url'
import { createTransport } from 'nodemailer'
import { compileMjmlTemplate } from './emailTemplateLoader.js'
import { loadTranslations, normalizeLocale, getEmailSubject } from './emailTranslations.js'
import { decryptSiloSmtpPassword } from './siloSmtpCrypto.js'
import { normalizeSiloSettings } from './siloSettings.js'
import { isSiloSmtpConfigured, resolveSiloEmailBranding, resolveSiloSmtpAuthUser } from './siloEmailSettings.js'
import { error, info } from '../model/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_EVENT_IMAGE = 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800'
const TRANSPORT_CACHE_TTL_MS = 5 * 60 * 1000

const transportCache = new Map()

function getSiloEmailDir() {
	return path.join(__dirname, '..', 'emailTemplates', 'silo')
}

export function resolveSiloSmtpConfig(merchant) {
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const silo = normalizeSiloSettings(obj?.siloSettings || {})
	if (!isSiloSmtpConfigured(silo.email)) {
		return null
	}
	const smtp = silo.email.smtp
	let password
	try {
		password = decryptSiloSmtpPassword(smtp.password)
	} catch (err) {
		error('[siloMail] failed to decrypt SMTP password', { err: err.message })
		return null
	}
	const fromName = smtp.fromName || obj?.orgName || obj?.name || 'Events'
	const user = resolveSiloSmtpAuthUser(smtp)
	return {
		host: smtp.host,
		port: smtp.port || 587,
		secure: Boolean(smtp.secure),
		user,
		password,
		fromEmail: smtp.fromEmail,
		from: `${fromName} <${smtp.fromEmail}>`,
		replyTo: silo.email.replyTo || obj?.companyEmail || obj?.email || smtp.fromEmail
	}
}

function cacheKey(merchantId, smtp) {
	return `${merchantId}:${smtp.user}:${smtp.host}:${smtp.port}`
}

function getOrCreateTransport(merchantId, smtpConfig) {
	const key = cacheKey(merchantId, smtpConfig)
	const cached = transportCache.get(key)
	if (cached && Date.now() - cached.createdAt < TRANSPORT_CACHE_TTL_MS) {
		return cached.transport
	}
	const transport = createTransport({
		host: smtpConfig.host,
		port: smtpConfig.port,
		secure: smtpConfig.secure,
		auth: {
			user: smtpConfig.user,
			pass: smtpConfig.password
		},
		connectionTimeout: 10000,
		greetingTimeout: 10000,
		socketTimeout: 15000
	})
	transportCache.set(key, { transport, createdAt: Date.now() })
	return transport
}

export async function sendSiloEmail(merchant, { to, subject, html, replyTo, attachments, icalEvent }) {
	if (!process.env.SEND_MAIL) return null
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const merchantId = String(obj?._id || obj?.id || 'unknown')
	const smtpConfig = resolveSiloSmtpConfig(merchant)
	if (!smtpConfig) {
		throw new Error('SILO_EMAIL_NOT_CONFIGURED')
	}
	const transport = getOrCreateTransport(merchantId, smtpConfig)
	const mailOptions = {
		from: smtpConfig.from,
		replyTo: replyTo || smtpConfig.replyTo,
		to,
		subject,
		html
	}
	if (Array.isArray(attachments) && attachments.length > 0) {
		mailOptions.attachments = attachments
	}
	if (icalEvent) {
		mailOptions.icalEvent = icalEvent
	}
	const result = await transport.sendMail(mailOptions)
	info('[siloMail] email sent', { merchantId, to: String(to).slice(0, 3) + '…' })
	return result
}

async function compileSiloTemplate(localeKey, locale, variables) {
	const normalizedLocale = normalizeLocale(locale)
	const translations = await loadTranslations(localeKey, normalizedLocale)
	return compileMjmlTemplate(path.join(getSiloEmailDir(), `${localeKey}.mjml`), {
		...variables,
		t: translations
	})
}

export async function loadSiloVerificationCodeTemplate(code, locale, branding) {
	const currentYear = new Date().getFullYear()
	return compileSiloTemplate('verification_code', locale, {
		verificationCode: code,
		currentYear,
		companyName: branding.companyName,
		companyLogo: branding.companyLogo || '',
		accentColor: branding.accentColor || '#f5b700',
		brandingContactEmail: branding.brandingContactEmail
	})
}

export async function loadSiloWaitlistJoinedTemplate(eventTitle, locale, branding, options = {}) {
	const currentYear = new Date().getFullYear()
	return compileSiloTemplate('waitlist_joined', locale, {
		eventTitle: eventTitle || 'Event',
		currentYear,
		companyName: branding.companyName,
		companyLogo: branding.companyLogo || '',
		accentColor: branding.accentColor || '#f5b700',
		brandingContactEmail: branding.brandingContactEmail,
		eventPromotionalPhoto: options.eventPromotionalPhoto || DEFAULT_EVENT_IMAGE
	})
}

export async function loadSiloPresaleLinkTemplate(eventTitle, presaleLink, validHours, locale, branding, options = {}) {
	const currentYear = new Date().getFullYear()
	return compileSiloTemplate('presale_link', locale, {
		eventTitle: eventTitle || 'Event',
		presaleLink,
		validHours: String(validHours),
		currentYear,
		companyName: branding.companyName,
		companyLogo: branding.companyLogo || '',
		accentColor: branding.accentColor || '#f5b700',
		eventPromotionalPhoto: options.eventPromotionalPhoto || DEFAULT_EVENT_IMAGE
	})
}

export async function loadSiloSoldOutAvailableTemplate(eventTitle, eventUrl, locale, branding, options = {}) {
	const currentYear = new Date().getFullYear()
	return compileSiloTemplate('sold_out_available', locale, {
		eventTitle: eventTitle || 'Event',
		eventUrl,
		currentYear,
		companyName: branding.companyName,
		companyLogo: branding.companyLogo || '',
		accentColor: branding.accentColor || '#f5b700',
		eventPromotionalPhoto: options.eventPromotionalPhoto || DEFAULT_EVENT_IMAGE
	})
}

export async function getSiloEmailSubject(templateKey, locale, vars) {
	return getEmailSubject(templateKey, locale, vars)
}

export { resolveSiloEmailBranding }
