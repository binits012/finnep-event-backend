import { createOutboundMailLog } from '../model/outboundMailLog.js'
import { error } from '../model/logger.js'

/** Mask email for storage/logs — never persist full addresses in outbound mail audit. */
export function maskEmailForAudit(email) {
	if (!email || typeof email !== 'string') return ''
	const trimmed = email.trim()
	const at = trimmed.indexOf('@')
	if (at < 1) return '***'
	const local = trimmed.slice(0, at)
	const domain = trimmed.slice(at + 1)
	if (!domain) return '***'
	const maskedLocal =
		local.length > 4
			? `${local.slice(0, 2)}***${local.slice(-2)}`
			: `${local.slice(0, 1)}***`
	return `${maskedLocal}@${domain}`
}

function sanitizeErrorMessage(err) {
	const raw = err?.message || (typeof err === 'string' ? err : '') || 'send_failed'
	// Drop anything that looks like an email address from error text.
	return String(raw).replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted]').slice(0, 500)
}

/**
 * Fire-and-forget audit row for outbound mail hand-off (SMTP accept / fail).
 * Does not throw — logging must never break delivery.
 */
export async function recordOutboundMailAttempt(fields = {}) {
	try {
		const toMasked =
			fields.toMasked ||
			(fields.to ? maskEmailForAudit(fields.to) : '')

		await createOutboundMailLog({
			merchant: fields.merchantId || undefined,
			externalMerchantId: fields.externalMerchantId ? String(fields.externalMerchantId) : '',
			ticket: fields.ticketId || undefined,
			mailType: fields.mailType || 'other',
			toMasked,
			transport: fields.transport || 'unknown',
			channel: fields.channel || 'unknown',
			status: fields.status || 'failed',
			providerMessageId: fields.providerMessageId ? String(fields.providerMessageId) : '',
			errorCode: fields.errorCode ? String(fields.errorCode).slice(0, 120) : '',
			errorMessage: fields.errorMessage
				? sanitizeErrorMessage(fields.errorMessage)
				: fields.error
					? sanitizeErrorMessage(fields.error)
					: '',
			triggeredBy: fields.triggeredBy || 'system',
			initiatedBy: fields.initiatedBy ? String(fields.initiatedBy).slice(0, 120) : '',
		})
	} catch (err) {
		error('[outboundMailLog] failed to persist attempt: %s', err?.message || err)
	}
}
