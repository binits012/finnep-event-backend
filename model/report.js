import * as model from './mongoModel.js';
import * as Event from './event.js';
import * as ExternalTicketSales from './externalTicketSales.js';
import { getPackSizeFromTicketType } from '../util/ticketQuantity.js';
import { error, info } from './logger.js';

/** Read a field from ticketInfo whether stored as Map or plain object (lean). */
const ticketInfoValue = (ticketInfo, key) => {
    if (!ticketInfo) return undefined;
    if (typeof ticketInfo.get === 'function') {
        return ticketInfo.get(key);
    }
    return ticketInfo[key];
};

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const findCatalogTicketType = (event, { ticketId, typeField, nameHint }) => {
    const catalog = event.ticketInfo || [];
    if (ticketId) {
        const byId = catalog.find((t) => t._id?.toString() === String(ticketId));
        if (byId) return byId;
    }
    if (typeField) {
        const typeStr = String(typeField);
        const byId = catalog.find((t) => t._id?.toString() === typeStr);
        if (byId) return byId;
        const byName = catalog.find((t) => t.name === typeStr);
        if (byName) return byName;
    }
    if (nameHint) {
        const byName = catalog.find((t) => t.name === nameHint);
        if (byName) return byName;
    }
    return null;
};

/**
 * Financial report contract (same as checkout / ticketQuantity.js):
 *
 * Each sold Ticket document = one payment / one order line.
 * - ticketInfo.price | totalPrice | totalAmount = full amount paid (never × quantity).
 * - ticketInfo.orderQuantity = packs/orders bought (commerce qty).
 * - ticketInfo.quantity = admission headcount (orderQuantity × packSize, or seats).
 * - ticketInfo.packSize = pack size when applicable.
 *
 * Financial breakdown uses orderQuantity (or admission÷packSize), NOT admission × price.
 */

/** Amount actually paid for this ticket document — never multiply by quantity. */
export const resolvePaidOrderTotal = (info) => {
    const totalPrice = toNumber(ticketInfoValue(info, 'totalPrice'), 0);
    const totalAmount = toNumber(ticketInfoValue(info, 'totalAmount'), 0);
    const price = toNumber(ticketInfoValue(info, 'price'), 0);
    return totalPrice || totalAmount || price || 0;
};

/** Sold count for financial report (orders/packs, or seats). */
export const resolveFinancialSoldQuantity = (info, event, ticket, seatCount) => {
    if (seatCount > 0) {
        return seatCount;
    }

    const orderQuantity = toNumber(ticketInfoValue(info, 'orderQuantity'), 0);
    if (orderQuantity > 0) {
        return orderQuantity;
    }

    const admissionQuantity = Math.max(1, toNumber(ticketInfoValue(info, 'quantity'), 1));
    const storedPackSize = toNumber(ticketInfoValue(info, 'packSize'), 0);

    if (!event) {
        return admissionQuantity;
    }

    const ticketId = ticketInfoValue(info, 'ticketId');
    const nameHint = ticketInfoValue(info, 'ticketName') || ticketInfoValue(info, 'name');
    const catalog = findCatalogTicketType(event, {
        ticketId,
        typeField: ticket.type,
        nameHint
    });
    const packSize = storedPackSize > 1 ? storedPackSize : getPackSizeFromTicketType(catalog);

    if (packSize > 1 && admissionQuantity >= packSize) {
        return Math.max(1, Math.round(admissionQuantity / packSize));
    }

    return admissionQuantity;
};

export const getLocalTicketSaleMetrics = (ticket, event = null) => {
    const info = ticket.ticketInfo;
    const seatTickets = ticketInfoValue(info, 'seatTickets');
    const seatCount = Array.isArray(seatTickets) ? seatTickets.length : 0;

    const admissionQuantity = Math.max(1, toNumber(ticketInfoValue(info, 'quantity'), 1));
    const orderQuantity = toNumber(ticketInfoValue(info, 'orderQuantity'), 0);
    const revenue = resolvePaidOrderTotal(info);
    const quantity = resolveFinancialSoldQuantity(info, event, ticket, seatCount);

    return {
        quantity,
        revenue,
        admissionQuantity,
        orderQuantity: orderQuantity > 0 ? orderQuantity : null,
        seatTickets,
        seatCount
    };
};

const resolveExternalCatalogKey = (event, sale) => {
    const label = sale.ticketType
        || (sale.source === 'door_sale' ? 'Door Sale' : 'Other Sale');
    const catalog = findCatalogTicketType(event, { typeField: label, nameHint: label });
    if (catalog) {
        return { key: catalog._id.toString(), ticketType: catalog.name };
    }
    return { key: `external:${label}`, ticketType: label };
};

/** Build empty breakdown rows keyed by event.ticketInfo._id (aligned with catalog). */
export const buildCatalogTicketBreakdown = (event) => {
    const breakdownByKey = {};
    (event.ticketInfo || []).forEach((tt) => {
        const key = tt._id.toString();
        breakdownByKey[key] = {
            ticketTypeId: key,
            ticketType: tt.name,
            catalogPrice: tt.price,
            catalogQuantity: tt.quantity,
            localQuantity: 0,
            localRevenue: 0,
            externalQuantity: 0,
            externalRevenue: 0,
            quantity: 0,
            totalRevenue: 0,
            tickets: [],
            externalSales: []
        };
    });
    return breakdownByKey;
};

const ensureBreakdownRow = (breakdownByKey, key, ticketType, event) => {
    if (!breakdownByKey[key]) {
        const catalog = findCatalogTicketType(event, { ticketId: key, typeField: key, nameHint: ticketType });
        breakdownByKey[key] = {
            ticketTypeId: catalog?._id?.toString() || null,
            ticketType: catalog?.name || ticketType,
            catalogPrice: catalog?.price ?? null,
            catalogQuantity: catalog?.quantity ?? null,
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
    return breakdownByKey[key];
};

const addLocalSaleToBreakdown = (breakdownByKey, event, ticket, key, ticketType, quantity, revenue) => {
    const row = ensureBreakdownRow(breakdownByKey, key, ticketType, event);
    row.localQuantity += quantity;
    row.localRevenue += revenue;
    row.tickets.push({
        ticketId: ticket._id,
        quantity,
        price: quantity > 0 ? revenue / quantity : 0,
        purchaseDate: ticket.createdAt,
        source: 'local'
    });
};

/**
 * Allocate one local ticket document into catalog ticket-type rows.
 * Seat-based orders split by seatTickets[].ticketId; others use ticketId / type / name.
 */
export const allocateLocalTicketToBreakdown = (breakdownByKey, event, ticket) => {
    const { quantity, revenue, seatTickets, seatCount } = getLocalTicketSaleMetrics(ticket, event);

    if (seatCount > 0) {
        const groups = {};
        seatTickets.forEach((seat) => {
            const ticketId = seat?.ticketId ? String(seat.ticketId) : null;
            if (!ticketId) return;
            if (!groups[ticketId]) {
                groups[ticketId] = { quantity: 0, revenue: 0 };
            }
            groups[ticketId].quantity += 1;
            if (seat.pricing) {
                const base = toNumber(seat.pricing.basePrice, 0);
                const serviceFee = toNumber(seat.pricing.serviceFee, 0);
                groups[ticketId].revenue += toNumber(seat.pricing.total, base + serviceFee);
            }
        });

        const groupedIds = Object.keys(groups);
        const pricedSum = groupedIds.reduce((sum, id) => sum + groups[id].revenue, 0);
        if (pricedSum <= 0) {
            groupedIds.forEach((ticketId) => {
                groups[ticketId].revenue = revenue * (groups[ticketId].quantity / seatCount);
            });
        } else if (Math.abs(pricedSum - revenue) > 0.02) {
            const scale = revenue / pricedSum;
            groupedIds.forEach((ticketId) => {
                groups[ticketId].revenue *= scale;
            });
        }

        groupedIds.forEach((ticketId) => {
            const catalog = findCatalogTicketType(event, { ticketId });
            const key = catalog ? catalog._id.toString() : `orphan:${ticketId}`;
            const label = catalog?.name
                || seatTickets.find((s) => String(s.ticketId) === ticketId)?.ticketName
                || ticketId;
            addLocalSaleToBreakdown(
                breakdownByKey,
                event,
                ticket,
                key,
                label,
                groups[ticketId].quantity,
                groups[ticketId].revenue
            );
        });
        return;
    }

    const ticketId = ticketInfoValue(ticket.ticketInfo, 'ticketId');
    const nameHint = ticketInfoValue(ticket.ticketInfo, 'ticketName')
        || ticketInfoValue(ticket.ticketInfo, 'name');
    const catalog = findCatalogTicketType(event, {
        ticketId,
        typeField: ticket.type,
        nameHint
    });

    const key = catalog ? catalog._id.toString() : `type:${ticket.type || nameHint || 'unknown'}`;
    const label = catalog?.name || nameHint || ticket.type || 'Unknown';
    addLocalSaleToBreakdown(breakdownByKey, event, ticket, key, label, quantity, revenue);
};

export const finalizeTicketBreakdown = (breakdownByKey, { includeZeroCatalogRows = true } = {}) => {
    return Object.values(breakdownByKey)
        .map((breakdown) => {
            breakdown.quantity = breakdown.localQuantity + breakdown.externalQuantity;
            breakdown.totalRevenue = breakdown.localRevenue + breakdown.externalRevenue;
            breakdown.unitPrice = breakdown.quantity > 0
                ? breakdown.totalRevenue / breakdown.quantity
                : 0;
            breakdown.source = breakdown.localQuantity > 0 && breakdown.externalQuantity > 0
                ? 'combined'
                : breakdown.localQuantity > 0
                    ? 'local'
                    : breakdown.externalQuantity > 0
                        ? 'external'
                        : 'none';
            return breakdown;
        })
        .filter((row) => {
            if (row.quantity > 0 || row.localQuantity > 0 || row.externalQuantity > 0) {
                return true;
            }
            if (!includeZeroCatalogRows) return false;
            return Boolean(row.ticketTypeId) && !String(row.ticketTypeId).startsWith('external:')
                && !String(row.ticketTypeId).startsWith('orphan:')
                && !String(row.ticketTypeId).startsWith('type:');
        })
        .sort((a, b) => a.ticketType.localeCompare(b.ticketType));
};

export const getEventFinancialReport = async (eventId) => {
    try {
        info(`Generating financial report for event: ${eventId}`);

        const event = await Event.getEventById(eventId);
        if (!event) {
            throw new Error(`Event with ID ${eventId} not found`);
        }

        const localTickets = await model.Ticket.find({ event: eventId })
            .populate('merchant', 'name merchantId country')
            .lean()
            .exec();

        const localPayments = await model.Payment.find({ event: eventId })
            .populate('ticket')
            .lean()
            .exec();

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

        const breakdownByKey = buildCatalogTicketBreakdown(event);

        localTickets.forEach((ticket) => {
            allocateLocalTicketToBreakdown(breakdownByKey, event, ticket);
        });

        let externalTicketsSold = 0;
        let externalRevenue = 0;

        if (externalSales?.length > 0) {
            externalSales.forEach((sale) => {
                const { key, ticketType } = resolveExternalCatalogKey(event, sale);
                const row = ensureBreakdownRow(breakdownByKey, key, ticketType, event);
                const saleRevenue = toNumber(sale.unitPrice) * toNumber(sale.quantity, 1);

                row.externalQuantity += toNumber(sale.quantity, 1);
                row.externalRevenue += saleRevenue;
                externalTicketsSold += toNumber(sale.quantity, 1);
                externalRevenue += saleRevenue;

                row.externalSales.push({
                    saleId: sale._id || sale.messageId,
                    quantity: sale.quantity,
                    price: sale.unitPrice,
                    saleDate: sale.saleDate,
                    source: sale.source,
                    paymentMethod: sale.paymentMethod
                });
            });
        }

        const ticketBreakdown = finalizeTicketBreakdown(breakdownByKey);

        let localTicketsSold = 0;
        let localRevenue = 0;
        ticketBreakdown.forEach((row) => {
            localTicketsSold += row.localQuantity;
            localRevenue += row.localRevenue;
        });

        const totalTicketsSold = localTicketsSold + externalTicketsSold;
        const totalRevenue = localRevenue + externalRevenue;
        const occupancyRate = event.occupancy > 0
            ? (totalTicketsSold / event.occupancy) * 100
            : 0;

        const paymentBreakdown = {};
        localPayments.forEach((payment) => {
            const paymentInfo = payment.paymentInfo;
            const paymentMethod = ticketInfoValue(paymentInfo, 'paymentMethod')
                || ticketInfoValue(paymentInfo, 'method')
                || 'unknown';
            const amount = toNumber(ticketInfoValue(paymentInfo, 'amount'), 0);
            const currency = ticketInfoValue(paymentInfo, 'currency') || 'EUR';

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

        if (externalSales?.length > 0) {
            externalSales.forEach((sale) => {
                const paymentMethod = sale.paymentMethod || 'cash';
                const amount = toNumber(sale.unitPrice) * toNumber(sale.quantity, 1);
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

        const sourceBreakdown = {
            local: {
                ticketsSold: localTicketsSold,
                revenue: localRevenue,
                paymentMethods: Object.values(paymentBreakdown)
                    .filter((p) => p.source === 'local')
                    .map((p) => ({
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
                    ticketsSold: externalSales.filter((s) => s.source === 'door_sale')
                        .reduce((sum, s) => sum + toNumber(s.quantity, 1), 0),
                    revenue: externalSales.filter((s) => s.source === 'door_sale')
                        .reduce((sum, s) => sum + toNumber(s.unitPrice) * toNumber(s.quantity, 1), 0)
                },
                otherSales: {
                    ticketsSold: externalSales.filter((s) => s.source !== 'door_sale')
                        .reduce((sum, s) => sum + toNumber(s.quantity, 1), 0),
                    revenue: externalSales.filter((s) => s.source !== 'door_sale')
                        .reduce((sum, s) => sum + toNumber(s.unitPrice) * toNumber(s.quantity, 1), 0),
                    sources: [...new Set(externalSales.filter((s) => s.source !== 'door_sale').map((s) => s.source))]
                }
            }
        };

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
                totalRefunds: 0,
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
