import * as model from './mongoModel.js';
import * as Ticket from './ticket.js';
import * as Payment from './payment.js';
import * as Event from './event.js';
import * as ExternalTicketSales from './externalTicketSales.js';
import { error, info } from './logger.js';

export const getEventFinancialReport = async (eventId) => {
    try {
        info(`Generating financial report for event: ${eventId}`);

        // 1. Get event details
        const event = await Event.getEventById(eventId);
        if (!event) {
            throw new Error(`Event with ID ${eventId} not found`);
        }

        // 2. Get local tickets for event
        const localTickets = await model.Ticket.find({ event: eventId })
            .populate('merchant', 'name merchantId country')
            .lean()
            .exec();

        // 3. Get local payments for event
        const localPayments = await model.Payment.find({ event: eventId })
            .populate('ticket')
            .lean()
            .exec();

        // 4. Get external ticket sales from database (stored via RabbitMQ messages)
        let externalSales = [];
        let externalDataAvailable = false;
        let externalDataError = null;

        try {
            externalSales = await ExternalTicketSales.getExternalTicketSalesByEvent(eventId);
            externalDataAvailable = externalSales && externalSales.length > 0;
        } catch (err) {
            error('Error fetching external ticket sales: %s', err.stack);
            externalDataError = err.message;
        }

        // 5. Aggregate local ticket data
        const localTicketBreakdown = {};
        let localTicketsSold = 0;
        let localRevenue = 0;

        localTickets.forEach(ticket => {
            const ticketType = ticket.ticketInfo?.get?.('ticketName') ||
                             ticket.ticketInfo?.ticketName ||
                             ticket.type ||
                             'Unknown';
            const quantity = Number(ticket.ticketInfo?.get?.('quantity') ||
                                  ticket.ticketInfo?.quantity ||
                                  1);
            const price = Number(ticket.ticketInfo?.get?.('price') ||
                               ticket.ticketInfo?.price ||
                               0);

            if (!localTicketBreakdown[ticketType]) {
                localTicketBreakdown[ticketType] = {
                    ticketType,
                    localQuantity: 0,
                    localRevenue: 0,
                    externalQuantity: 0,
                    externalRevenue: 0,
                    quantity: 0,
                    totalRevenue: 0,
                    tickets: [],
                    externalSales: []
                };
            }

            localTicketBreakdown[ticketType].localQuantity += quantity;
            localTicketBreakdown[ticketType].localRevenue += (price * quantity);
            localTicketsSold += quantity;
            localRevenue += (price * quantity);

            localTicketBreakdown[ticketType].tickets.push({
                ticketId: ticket._id,
                quantity,
                price,
                purchaseDate: ticket.createdAt,
                source: 'local'
            });
        });

        // 6. Aggregate external ticket data (door sales + other sales)
        let externalTicketsSold = 0;
        let externalRevenue = 0;

        if (externalSales && externalSales.length > 0) {
            externalSales.forEach(sale => {
                const ticketType = sale.ticketType ||
                                 (sale.source === 'door_sale' ? 'Door Sale' : 'Other Sale');

                if (!localTicketBreakdown[ticketType]) {
                    localTicketBreakdown[ticketType] = {
                        ticketType,
                        localQuantity: 0,
                        localRevenue: 0,
                        externalQuantity: 0,
                        externalRevenue: 0,
                        quantity: 0,
                        totalRevenue: 0,
                        tickets: [],
                        externalSales: []
                    };
                }

                localTicketBreakdown[ticketType].externalQuantity += sale.quantity;
                localTicketBreakdown[ticketType].externalRevenue += (sale.unitPrice * sale.quantity);
                externalTicketsSold += sale.quantity;
                externalRevenue += (sale.unitPrice * sale.quantity);

                localTicketBreakdown[ticketType].externalSales.push({
                    saleId: sale._id || sale.messageId,
                    quantity: sale.quantity,
                    price: sale.unitPrice,
                    saleDate: sale.saleDate,
                    source: sale.source,
                    paymentMethod: sale.paymentMethod
                });
            });
        }

        // 7. Calculate combined totals for each ticket type
        const ticketBreakdown = Object.values(localTicketBreakdown).map(breakdown => {
            breakdown.quantity = breakdown.localQuantity + breakdown.externalQuantity;
            breakdown.totalRevenue = breakdown.localRevenue + breakdown.externalRevenue;
            breakdown.unitPrice = breakdown.quantity > 0
                ? breakdown.totalRevenue / breakdown.quantity
                : 0;
            breakdown.source = breakdown.localQuantity > 0 && breakdown.externalQuantity > 0
                ? 'combined'
                : breakdown.localQuantity > 0
                ? 'local'
                : 'external';
            return breakdown;
        });

        // 8. Calculate summary totals
        const totalTicketsSold = localTicketsSold + externalTicketsSold;
        const totalRevenue = localRevenue + externalRevenue;
        const occupancyRate = event.occupancy > 0
            ? (totalTicketsSold / event.occupancy) * 100
            : 0;

        // 9. Aggregate payment breakdown
        const paymentBreakdown = {};
        localPayments.forEach(payment => {
            const paymentInfo = payment.paymentInfo;
            const paymentMethod = paymentInfo?.get?.('paymentMethod') ||
                                paymentInfo?.paymentMethod ||
                                paymentInfo?.get?.('method') ||
                                paymentInfo?.method ||
                                'unknown';
            const amount = Number(paymentInfo?.get?.('amount') ||
                                paymentInfo?.amount ||
                                0);
            const currency = paymentInfo?.get?.('currency') ||
                           paymentInfo?.currency ||
                           'EUR';

            if (!paymentBreakdown[paymentMethod]) {
                paymentBreakdown[paymentMethod] = {
                    paymentMethod,
                    count: 0,
                    totalAmount: 0,
                    currency,
                    source: 'local'
                };
            }

            paymentBreakdown[paymentMethod].count += 1;
            paymentBreakdown[paymentMethod].totalAmount += amount;
        });

        // Add external payment methods
        if (externalSales && externalSales.length > 0) {
            externalSales.forEach(sale => {
                const paymentMethod = sale.paymentMethod || 'cash';
                const amount = sale.unitPrice * sale.quantity;
                const currency = sale.currency || 'EUR';

                if (!paymentBreakdown[paymentMethod]) {
                    paymentBreakdown[paymentMethod] = {
                        paymentMethod,
                        count: 0,
                        totalAmount: 0,
                        currency,
                        source: 'external'
                    };
                }

                paymentBreakdown[paymentMethod].count += 1;
                paymentBreakdown[paymentMethod].totalAmount += amount;
            });
        }

        // 10. Calculate source breakdown
        const sourceBreakdown = {
            local: {
                ticketsSold: localTicketsSold,
                revenue: localRevenue,
                paymentMethods: Object.values(paymentBreakdown)
                    .filter(p => p.source === 'local')
                    .map(p => ({
                        paymentMethod: p.paymentMethod,
                        count: p.count,
                        totalAmount: p.totalAmount,
                        currency: p.currency
                    }))
            },
            external: {
                ticketsSold: externalTicketsSold,
                revenue: externalRevenue,
                doorSales: {
                    ticketsSold: externalSales.filter(s => s.source === 'door_sale')
                        .reduce((sum, s) => sum + s.quantity, 0),
                    revenue: externalSales.filter(s => s.source === 'door_sale')
                        .reduce((sum, s) => sum + (s.unitPrice * s.quantity), 0)
                },
                otherSales: {
                    ticketsSold: externalSales.filter(s => s.source !== 'door_sale')
                        .reduce((sum, s) => sum + s.quantity, 0),
                    revenue: externalSales.filter(s => s.source !== 'door_sale')
                        .reduce((sum, s) => sum + (s.unitPrice * s.quantity), 0),
                    sources: [...new Set(externalSales.filter(s => s.source !== 'door_sale').map(s => s.source))]
                }
            }
        };

        // 11. Build response
        const report = {
            event: {
                _id: event._id,
                eventTitle: event.eventTitle,
                eventDate: event.eventDate,
                occupancy: event.occupancy,
                merchant: event.merchant ? {
                    _id: event.merchant._id,
                    name: event.merchant.name,
                    merchantId: event.merchant.merchantId,
                    country: event.merchant.country
                } : null,
                ticketInfo: event.ticketInfo || []
            },
            summary: {
                totalTicketsSold,
                totalRevenue,
                totalOccupancy: event.occupancy,
                occupancyRate: Math.round(occupancyRate * 100) / 100,
                localTicketsSold,
                localRevenue,
                externalTicketsSold,
                externalRevenue,
                totalPayments: localPayments.length,
                totalRefunds: 0, // TODO: Implement refund tracking if needed
                netRevenue: totalRevenue
            },
            ticketBreakdown,
            sourceBreakdown,
            paymentBreakdown: Object.values(paymentBreakdown),
            merchantInfo: event.merchant ? {
                name: event.merchant.name,
                merchantId: event.merchant.merchantId,
                country: event.merchant.country,
                stripeAccount: event.merchant.stripeAccount
            } : null,
            dataSource: {
                localDataAvailable: localTickets.length > 0 || localPayments.length > 0,
                externalDataAvailable,
                externalDataError
            }
        };

        info(`Financial report generated successfully for event: ${eventId}`);
        return report;

    } catch (err) {
        error('Error generating financial report: %s', err.stack);
        throw err;
    }
};

