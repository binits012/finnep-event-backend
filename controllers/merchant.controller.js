import * as consts from '../const.js'
import * as Merchant from '../model/merchant.js'
import { error, info } from '../model/logger.js'
import { RESOURCE_NOT_FOUND, INTERNAL_SERVER_ERROR } from '../applicationTexts.js'
import * as jwtToken from '../util/jwtToken.js'
import * as appText from '../applicationTexts.js'
import * as OutboxMessage from '../model/outboxMessage.js'
import { v4 as uuidv4 } from 'uuid'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import dotenv from 'dotenv'
dotenv.config()
import { dirname } from 'path'
const __dirname = dirname(import.meta.url).slice(7)
import { loadEmailTemplateForMerchant } from '../util/common.js'
import { forward } from '../util/sendMail.js'

export const createMerchant = async (req, res, next) => {
    return res.status(consts.HTTP_STATUS_NOT_IMPLEMENTED).json({
        message: 'Merchant creation via API is not supported. Merchants are synchronized from external system.'
    })
}

export const getMerchantById = async (req, res, next) => {
    const token = req.headers.authorization
    const id = req.params.id

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            try {
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER === userRoleFromToken) {
                    return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                        message: 'You are not authorized to perform this action'
                    })
                }

                const merchant = await Merchant.getMerchantById(id)
                if (merchant) {
                    return res.status(consts.HTTP_STATUS_OK).json(merchant)
                } else {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).send({ error: RESOURCE_NOT_FOUND })
                }
            } catch (err) {
                error(err)
                if (!res.headersSent) {
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR })
                }
            }
        }
    })
}

export const getMerchantByMerchantId = async (req, res, next) => {
    const token = req.headers.authorization
    const merchantId = req.params.merchantId

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            try {
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER === userRoleFromToken) {
                    return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                        message: 'You are not authorized to perform this action'
                    })
                }

                const merchant = await Merchant.getMerchantByMerchantId(merchantId)
                if (merchant) {
                    return res.status(consts.HTTP_STATUS_OK).json(merchant)
                } else {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).send({ error: RESOURCE_NOT_FOUND })
                }
            } catch (err) {
                error(err)
                if (!res.headersSent) {
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR })
                }
            }
        }
    })
}

export const getAllMerchants = async (req, res, next) => {
    const token = req.headers.authorization

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            try {
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER === userRoleFromToken) {
                    return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                        message: 'You are not authorized to perform this action'
                    })
                }

                const merchants = await Merchant.getAllMerchants()
                res.status(consts.HTTP_STATUS_OK).json(merchants)
            } catch (err) {
                error(err)
                if (!res.headersSent) {
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR })
                }
            }
        }
    })
}

export const updateMerchantById = async (req, res, next) => {
    const token = req.headers.authorization
    const id = req.params.id
    const { status } = req.body
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            try {
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER === userRoleFromToken) {
                    return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                        message: 'You are not authorized to perform this action'
                    })
                }

                // Get the original merchant data before update
                const originalMerchant = await Merchant.getMerchantById(id)
                if (!originalMerchant) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).send({ error: RESOURCE_NOT_FOUND })
                }

                // 1. Update merchant
                const updatedMerchant = await Merchant.updateMerchantById(id, { 'status': status })

                if (updatedMerchant) {
                    try {
                        // 2. Create outbox message entry
                        const correlationId = uuidv4()
                        const messageId = uuidv4()

                        // Determine routing key and event type based on status
                        const routingKey = 'external.merchant.status.updated'
                        const eventType = status === 'active' ? 'MerchantActivated' : 'MerchantSuspended'

                        const outboxMessageData = {
                            messageId: messageId,
                            exchange: 'event-merchant-exchange',   
                            routingKey: routingKey,
                            messageBody: {
                                eventType: eventType,
                                aggregateId: updatedMerchant._id.toString(),
                                data: {
                                    merchantId: updatedMerchant.merchantId,
                                    before: originalMerchant,
                                    after: updatedMerchant,
                                    updatedBy: data.userId,
                                    updatedAt: new Date()
                                },
                                metadata: {
                                    correlationId: correlationId,
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
                            correlationId: correlationId,
                            eventType: eventType,
                            aggregateId: updatedMerchant._id.toString(),
                            status: 'pending',
                            exchangeType: 'topic'
                        }

                        const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData)
                        info('Outbox message created for merchant update:', outboxMessage._id)

                        // 3. Publish to RabbitMQ exchange
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
                        ).then(async () => {
                            info('Merchant update event published successfully: %s', outboxMessageData.messageId)

                            //send the mail about the status
                            const fileLocation = __dirname.replace('controllers', '') + (status === 'active' ? '/emailTemplates/merchant_activated.html'
                                : '/emailTemplates/merchant_suspended.html')
                            console.log('File location:', status, fileLocation)
                            const dashboardUrl = process.env.DASHBOARD_URL+updatedMerchant?.merchantId+'/login'
                            const loadedData = await loadEmailTemplateForMerchant(fileLocation, updatedMerchant?.orgName, dashboardUrl)
                            const message = {
                                from: process.env.EMAIL_USERNAME,
                                to: updatedMerchant?.companyEmail,
                                subject: status === 'active' ? 'Merchant Activated' : 'Merchant Suspended',
                                html: loadedData.toString(),

                            }
                            await forward(message)
                        }).catch(publishError => {
                            error('Error publishing merchant update event:', publishError)
                            throw publishError
                        }
                        )

                        info('Published merchant update event to exchange: %s', outboxMessageData.exchange)

                    } catch (publishError) {
                        error('Failed to create outbox message or publish merchant update event:', publishError)
                        // Continue with response even if publishing fails
                    }

                    return res.status(consts.HTTP_STATUS_OK).json(updatedMerchant)
                } else {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).send({ error: RESOURCE_NOT_FOUND })
                }
            } catch (err) {
                error(err)
                if (!res.headersSent) {
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR })
                }
            }
        }
    })
}

export const deleteMerchantById = async (req, res, next) => {
    const token = req.headers.authorization
    const id = req.params.id

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            try {
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER === userRoleFromToken) {
                    return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                        message: 'You are not authorized to perform this action'
                    })
                }

                const deletedMerchant = await Merchant.deleteMerchantById(id)
                if (deletedMerchant) {
                    return res.status(consts.HTTP_STATUS_OK).json(deletedMerchant)
                } else {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).send({ error: RESOURCE_NOT_FOUND })
                }
            } catch (err) {
                error(err)
                if (!res.headersSent) {
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR })
                }
            }
        }
    })
}