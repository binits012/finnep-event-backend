import { v4 as uuidv4 } from 'uuid'
import * as OutboxMessage from '../model/outboxMessage.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import { info, error } from '../model/logger.js'

/**
 * Notify EMS when silo storefront is provisioned/deprovisioned from FEB CMS (API credentials).
 */
export async function publishMerchantSiloProvisioned({ merchant, siloEnabled, updatedBy }) {
	const correlationId = uuidv4()
	const messageId = uuidv4()
	const routingKey = 'external.merchant.status.updated'
	const eventType = 'MerchantSiloToggled'

	const outboxMessageData = {
		messageId,
		exchange: 'event-merchant-exchange',
		routingKey,
		messageBody: {
			eventType,
			aggregateId: merchant._id.toString(),
			data: {
				merchantId: merchant.merchantId,
				siloEnabled: Boolean(siloEnabled),
				updatedBy,
				updatedAt: new Date()
			},
			metadata: {
				correlationId,
				causationId: messageId,
				timestamp: new Date().toISOString(),
				version: 1
			}
		},
		headers: {
			'content-type': 'application/json',
			'message-type': eventType,
			'correlation-id': correlationId
		},
		correlationId,
		eventType,
		aggregateId: merchant._id.toString(),
		status: 'pending',
		exchangeType: 'topic'
	}

	await OutboxMessage.createOutboxMessage(outboxMessageData)

	await messageConsumer.publishToExchange(
		outboxMessageData.exchange,
		outboxMessageData.routingKey,
		outboxMessageData.messageBody,
		{
			exchangeType: 'topic',
			publishOptions: {
				correlationId: outboxMessageData.correlationId,
				contentType: 'application/json',
				persistent: true,
				headers: outboxMessageData.headers
			}
		}
	)

	info('Merchant silo provision event published: merchantId=%s enabled=%s', merchant.merchantId, siloEnabled)
}

export async function publishMerchantSiloProvisionedSafe(options) {
	try {
		await publishMerchantSiloProvisioned(options)
	} catch (publishError) {
		error('Failed to publish merchant silo provision event:', publishError)
	}
}

/**
 * Request platform infra provisioning/deprovisioning for per-merchant silo hosting (Option A).
 */
export async function publishMerchantSiloDeploymentRequested({ merchant, action, updatedBy }) {
	const correlationId = uuidv4()
	const messageId = uuidv4()
	const routingKey = 'external.merchant.status.updated'
	const eventType = 'MerchantSiloDeploymentRequested'

	const outboxMessageData = {
		messageId,
		exchange: 'event-merchant-exchange',
		routingKey,
		messageBody: {
			eventType,
			aggregateId: merchant._id.toString(),
			data: {
				merchantId: merchant.merchantId,
				action,
				mode: 'per_merchant',
				updatedBy,
				updatedAt: new Date(),
			},
			metadata: {
				correlationId,
				causationId: messageId,
				timestamp: new Date().toISOString(),
				version: 1
			}
		},
		headers: {
			'content-type': 'application/json',
			'message-type': eventType,
			'correlation-id': correlationId
		},
		correlationId,
		eventType,
		aggregateId: merchant._id.toString(),
		status: 'pending',
		exchangeType: 'topic'
	}

	await OutboxMessage.createOutboxMessage(outboxMessageData)

	await messageConsumer.publishToExchange(
		outboxMessageData.exchange,
		outboxMessageData.routingKey,
		outboxMessageData.messageBody,
		{
			exchangeType: 'topic',
			publishOptions: {
				correlationId: outboxMessageData.correlationId,
				contentType: 'application/json',
				persistent: true,
				headers: outboxMessageData.headers
			}
		}
	)

	info('Merchant silo deployment request published: merchantId=%s action=%s', merchant.merchantId, action)
}

export async function publishMerchantSiloDeploymentRequestedSafe(options) {
	try {
		await publishMerchantSiloDeploymentRequested(options)
	} catch (publishError) {
		error('Failed to publish merchant silo deployment request:', publishError)
	}
}

/**
 * Broadcast infra deployment status to EMS so EMF can show read-only hosting status.
 */
export async function publishMerchantSiloDeploymentStatusChanged({
	merchant,
	action,
	status,
	deployment
}) {
	const correlationId = uuidv4()
	const messageId = uuidv4()
	const routingKey = 'external.merchant.status.updated'
	const eventType = 'MerchantSiloDeploymentStatusChanged'

	const outboxMessageData = {
		messageId,
		exchange: 'event-merchant-exchange',
		routingKey,
		messageBody: {
			eventType,
			aggregateId: merchant._id.toString(),
			data: {
				merchantId: merchant.merchantId,
				action,
				status,
				deployment,
				updatedAt: new Date()
			},
			metadata: {
				correlationId,
				causationId: messageId,
				timestamp: new Date().toISOString(),
				version: 1
			}
		},
		headers: {
			'content-type': 'application/json',
			'message-type': eventType,
			'correlation-id': correlationId
		},
		correlationId,
		eventType,
		aggregateId: merchant._id.toString(),
		status: 'pending',
		exchangeType: 'topic'
	}

	await OutboxMessage.createOutboxMessage(outboxMessageData)
	await messageConsumer.publishToExchange(
		outboxMessageData.exchange,
		outboxMessageData.routingKey,
		outboxMessageData.messageBody,
		{
			exchangeType: 'topic',
			publishOptions: {
				correlationId: outboxMessageData.correlationId,
				contentType: 'application/json',
				persistent: true,
				headers: outboxMessageData.headers
			}
		}
	)

	info(
		'Merchant silo deployment status published: merchantId=%s action=%s status=%s',
		merchant.merchantId,
		action,
		status
	)
}

export async function publishMerchantSiloDeploymentStatusChangedSafe(options) {
	try {
		await publishMerchantSiloDeploymentStatusChanged(options)
	} catch (publishError) {
		error('Failed to publish merchant silo deployment status:', publishError)
	}
}

/**
 * Notify EMS when Nabil payment is enabled/disabled from FEB CMS.
 */
export async function publishMerchantNabilToggled({ merchant, nabilEnabled, updatedBy }) {
	const correlationId = uuidv4()
	const messageId = uuidv4()
	const routingKey = 'external.merchant.status.updated'
	const eventType = 'MerchantNabilToggled'

	const outboxMessageData = {
		messageId,
		exchange: 'event-merchant-exchange',
		routingKey,
		messageBody: {
			eventType,
			aggregateId: merchant._id.toString(),
			data: {
				merchantId: merchant.merchantId,
				nabilEnabled: Boolean(nabilEnabled),
				updatedBy,
				updatedAt: new Date()
			},
			metadata: {
				correlationId,
				causationId: messageId,
				timestamp: new Date().toISOString(),
				version: 1
			}
		},
		headers: {
			'content-type': 'application/json',
			'message-type': eventType,
			'correlation-id': correlationId
		},
		correlationId,
		eventType,
		aggregateId: merchant._id.toString(),
		status: 'pending',
		exchangeType: 'topic'
	}

	await OutboxMessage.createOutboxMessage(outboxMessageData)

	await messageConsumer.publishToExchange(
		outboxMessageData.exchange,
		outboxMessageData.routingKey,
		outboxMessageData.messageBody,
		{
			exchangeType: 'topic',
			publishOptions: {
				correlationId: outboxMessageData.correlationId,
				contentType: 'application/json',
				persistent: true,
				headers: outboxMessageData.headers
			}
		}
	)

	info('Merchant Nabil toggle event published: merchantId=%s enabled=%s', merchant.merchantId, nabilEnabled)
}

export async function publishMerchantNabilToggledSafe(options) {
	try {
		await publishMerchantNabilToggled(options)
	} catch (publishError) {
		error('Failed to publish merchant Nabil toggle event:', publishError)
	}
}
