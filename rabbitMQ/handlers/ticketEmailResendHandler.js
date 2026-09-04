import { inboxModel } from '../../model/inboxMessage.js'
import { resendTicketEmail } from '../../util/ticketMaster.js'
import { publishTicketEmailStatusToEms } from '../../util/ticketEmailStatusPublish.js'
import { error, info } from '../../model/logger.js'

const resolveMessageId = (message) => {
	return message?.metadata?.causationId
		|| message?.metadata?.correlationId
		|| message?.messageId
		|| message?.data?.messageId
		|| `TicketEmailResend:${message?.data?.ticketId || message?.aggregateId || 'unknown'}`
}

const saveInboxOnce = async (message) => {
	const messageId = resolveMessageId(message)
	if (messageId) {
		const isProcessed = await inboxModel.isProcessed(messageId)
		if (isProcessed) {
			info(`[ticketEmailResend] Message ${messageId} already processed, skipping`)
			return { skipped: true, messageId }
		}
	}

	try {
		await inboxModel.saveMessage({
			messageId,
			eventType: message.eventType || message.type || 'TicketEmailResendRequested',
			aggregateId: message.aggregateId || message.data?.ticketId,
			data: message,
			metadata: message?.metadata || { receivedAt: new Date() },
		})
	} catch (saveError) {
		if (saveError.code === 11000 && messageId) {
			const isAlreadyProcessed = await inboxModel.isProcessed(messageId)
			if (isAlreadyProcessed) {
				return { skipped: true, messageId }
			}
		}
		throw saveError
	}

	return { skipped: false, messageId }
}

/**
 * EMS outbox → RabbitMQ `external.event.ticket.email.resend`
 * Rebuild + send on FEB; status is published to EMS by deliverTicketEmailPayload.
 * On hard failures before send, publish failed status here.
 */
export const handleTicketEmailResend = async (message) => {
	if (!message || typeof message !== 'object') {
		throw new Error('Ticket email resend message must be an object')
	}

	const inboxResult = await saveInboxOnce(message)
	if (inboxResult.skipped) return

	const data = message.data || message
	const ticketId = data.ticketId || message.aggregateId
	const externalMerchantId = data.externalMerchantId || data.merchantId
	const initiatedBy = data.initiatedBy || message.metadata?.initiatedBy || 'ems'

	if (!ticketId) {
		throw new Error('ticketId is required for ticket email resend')
	}

	info('[ticketEmailResend] processing', {
		ticketId,
		externalMerchantId: externalMerchantId || null,
		messageId: inboxResult.messageId,
	})

	try {
		const result = await resendTicketEmail(ticketId, {
			externalMerchantId,
			initiatedBy,
		})
		info('[ticketEmailResend] completed', {
			ticketId,
			transport: result.transport,
			messageId: inboxResult.messageId,
		})
	} catch (err) {
		error('[ticketEmailResend] failed: %s', err?.stack || err?.message || String(err))
		// deliverTicketEmailPayload already notifies EMS on SMTP failure; this covers
		// pre-send failures (missing recipient, etc.).
		try {
			await publishTicketEmailStatusToEms({
				ticketId,
				externalMerchantId,
				isSend: false,
				emailStatus: 'failed',
				errorMessage: err?.message || 'resend_failed',
				initiatedBy,
				messageId: `${inboxResult.messageId || ticketId}-failed`,
			})
		} catch (publishErr) {
			error('[ticketEmailResend] failed to publish status: %s', publishErr?.message || publishErr)
		}
		throw err
	}
}
