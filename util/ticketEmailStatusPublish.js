import * as OutboxMessage from '../model/outboxMessage.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import { error, info } from '../model/logger.js'

/**
 * Tell EMS the outcome of a FEB ticket email attempt (accepted / failed).
 * Routing key: external.event.ticket.status.updated
 */
export async function publishTicketEmailStatusToEms({
	ticketId,
	externalMerchantId,
	isSend,
	emailStatus,
	transport = '',
	channel = '',
	errorMessage = '',
	initiatedBy = 'system',
	messageId = null,
} = {}) {
	if (!ticketId) return null

	const correlationId = messageId || `ticket-email-status-${ticketId}-${Date.now()}`
	const eventData = {
		eventType: 'TicketUpdated',
		aggregateId: String(ticketId),
		ticketId: String(ticketId),
		data: {
			ticketId: String(ticketId),
			externalMerchantId: String(externalMerchantId || ''),
			ticket: {
				_id: String(ticketId),
				isSend: Boolean(isSend),
				ticketInfo: {
					email_last_status: emailStatus,
					email_last_at: new Date().toISOString(),
					email_last_transport: transport || '',
					email_last_channel: channel || '',
					email_last_error: errorMessage ? String(errorMessage).slice(0, 200) : '',
				},
			},
		},
		metadata: {
			correlationId,
			causationId: correlationId,
			timestamp: new Date().toISOString(),
			version: 1,
			source: 'finnep-eventapp',
			initiatedBy: initiatedBy || 'system',
		},
	}

	const outboxMessageData = {
		messageId: correlationId,
		exchange: 'event-merchant-exchange',
		routingKey: 'external.event.ticket.status.updated',
		messageBody: eventData,
		headers: {
			'content-type': 'application/json',
			'message-type': 'TicketUpdated',
			'correlation-id': correlationId,
			'event-version': '1.0',
		},
		correlationId,
		eventType: 'TicketUpdated',
		aggregateId: String(ticketId),
		status: 'pending',
		exchangeType: 'topic',
		maxRetries: 3,
		attempts: 0,
	}

	const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData)
	try {
		await messageConsumer.publishToExchange(
			outboxMessageData.exchange,
			outboxMessageData.routingKey,
			outboxMessageData.messageBody,
			{
				exchangeType: 'topic',
				publishOptions: {
					messageId: outboxMessageData.messageId,
					correlationId: outboxMessageData.correlationId,
					contentType: 'application/json',
					persistent: true,
					headers: outboxMessageData.headers,
				},
			}
		)
		await OutboxMessage.markMessageAsSent(outboxMessage._id)
		info('[ticketEmailStatus] published to EMS', {
			ticketId: String(ticketId),
			emailStatus,
			externalMerchantId: String(externalMerchantId || ''),
		})
		return outboxMessage
	} catch (publishError) {
		await OutboxMessage.markMessageAsFailed(outboxMessage._id, publishError.message)
		error('[ticketEmailStatus] publish failed: %s', publishError?.message || publishError)
		throw publishError
	}
}
