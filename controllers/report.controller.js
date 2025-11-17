import * as jwtToken from '../util/jwtToken.js';
import * as Report from '../model/report.js';
import * as Event from '../model/event.js';
import * as consts from '../const.js';
import { error, info } from '../model/logger.js';
import * as ExternalTicketSalesRequest from '../services/externalTicketSalesRequest.js';
import * as ExternalTicketSales from '../model/externalTicketSales.js';

export const getEventFinancialReport = async (req, res, next) => {
    const token = req.headers.authorization;
    const eventId = req.params.eventId;

    try {
        if (!eventId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Event ID is required'
            });
        }

        // Verify JWT token
        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || !data) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            try {
                // Validate event exists
                const event = await Event.getEventById(eventId);
                if (!event) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        success: false,
                        message: 'Event not found'
                    });
                }

                // Validate event is completed
                if (event.status !== 'completed') {
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        success: false,
                        message: 'Financial report is only available for completed events'
                    });
                }

                // Check if external ticket sales data exists
                const existingExternalSales = await ExternalTicketSales.getExternalTicketSalesByEvent(eventId);
                const hasExternalData = existingExternalSales && existingExternalSales.length > 0;

                // If no external data exists, request it from external microservice
                if (!hasExternalData) {
                    info(`No external ticket sales data found for event ${eventId}, requesting from external microservice`);
                    try {
                        await ExternalTicketSalesRequest.requestExternalTicketSales(
                            event.externalEventId,
                            event.externalMerchantId
                        );
                        info(`Request sent to external microservice for event ${event.externalEventId}`);
                    } catch (requestError) {
                        error(`Failed to request external ticket sales data: ${requestError.message}`);
                        // Continue with report generation using local data only
                    }
                }

                // Generate financial report
                // Note: If external data was just requested, it may not be available yet
                // The report will show local data only, and external data will be available on next request
                info(`Generating financial report for event ${eventId} by user ${data.id || data.username || 'unknown'}`);
                const report = await Report.getEventFinancialReport(eventId);

                // Add flag to indicate if data was just requested
                const response = {
                    success: true,
                    data: report,
                    externalDataRequested: !hasExternalData
                };

                if (!hasExternalData) {
                    response.message = 'External ticket sales data has been requested. Please refresh the report in a few moments to see the complete data.';
                }

                return res.status(consts.HTTP_STATUS_OK).json(response);

            } catch (err) {
                error('Error generating financial report: %s', err.stack);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error generating financial report',
                    error: err.message
                });
            }
        });
    } catch (err) {
        error('Error in getEventFinancialReport: %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Manually request external ticket sales data for an event
 * This endpoint can be called to trigger a data request from the external microservice
 */
export const requestExternalTicketSalesData = async (req, res, next) => {
    const token = req.headers.authorization;
    const eventId = req.params.eventId;

    try {
        if (!eventId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Event ID is required'
            });
        }

        // Verify JWT token
        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || !data) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            try {
                // Validate event exists
                const event = await Event.getEventById(eventId);
                if (!event) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        success: false,
                        message: 'Event not found'
                    });
                }

                // Request external ticket sales data
                info(`Requesting external ticket sales data for event ${eventId} by user ${data.id || data.username || 'unknown'}`);
                const requestResult = await ExternalTicketSalesRequest.requestExternalTicketSales(
                    event.externalEventId,
                    event.externalMerchantId
                );

                return res.status(consts.HTTP_STATUS_OK).json({
                    success: true,
                    message: 'External ticket sales data request has been sent to the external microservice',
                    data: {
                        messageId: requestResult.messageId,
                        correlationId: requestResult.correlationId,
                        eventId: eventId,
                        externalEventId: event.externalEventId
                    }
                });

            } catch (err) {
                error('Error requesting external ticket sales data: %s', err.stack);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error requesting external ticket sales data',
                    error: err.message
                });
            }
        });
    } catch (err) {
        error('Error in requestExternalTicketSalesData: %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

