/**
 * Purchase quantity resolution (checkout, inventory, child QRs, EMS sync).
 * scanCount is gate-only — never used here; see validateScanCountOrderQuantity at checkout.
 */

const parsePositiveInt = (value, fallback = null) => {
    if (value == null || value === '') return fallback;
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
};

export const getPackSizeFromTicketType = (ticketTypeConfig) => {
    if (!ticketTypeConfig || typeof ticketTypeConfig !== 'object') return 1;

    const configuredQty = parsePositiveInt(
        ticketTypeConfig.quantity ?? ticketTypeConfig.qty,
        1
    );
    const available = parsePositiveInt(ticketTypeConfig.available, null);

    if (configuredQty > 1 && available != null && available > configuredQty) {
        return configuredQty;
    }

    return 1;
};

/**
 * Commerce headcount: orderQuantity × packSize (seats can raise admission).
 */
export const resolveTicketQuantities = ({
    orderQuantity,
    ticketTypeConfig = null,
    seatCount = 0
}) => {
    const orderQty = parsePositiveInt(orderQuantity, 1);
    const packSize = getPackSizeFromTicketType(ticketTypeConfig);
    let admissionQuantity = orderQty * packSize;

    const seats = parsePositiveInt(seatCount, 0) || 0;
    if (seats > admissionQuantity) {
        admissionQuantity = seats;
    }

    return {
        admissionQuantity,
        orderQuantity: orderQty,
        packSize
    };
};

export const applyTicketQuantitiesToTicketInfo = (ticketInfo, options) => {
    const quantities = resolveTicketQuantities(options);
    const updated = {
        ...ticketInfo,
        quantity: String(quantities.admissionQuantity),
        orderQuantity: String(quantities.orderQuantity)
    };
    if (quantities.packSize > 1) {
        updated.packSize = String(quantities.packSize);
    }
    return { ticketInfo: updated, quantities };
};

export const getScanCountFromTicketType = (ticketTypeConfig) => {
    if (!ticketTypeConfig) return null;
    const raw = ticketTypeConfig.scanCount ?? ticketTypeConfig.scan_count;
    return parsePositiveInt(raw, null);
};

/** True when ticket type is a multi-scan season/recurring pass (scanCount > 1). */
export const isSeasonPassTicketType = (ticketTypeConfig) => {
    const scanCount = getScanCountFromTicketType(ticketTypeConfig);
    return scanCount != null && scanCount > 1;
};

/** Checkout guard: season passes allow only one order line (qty 1). */
export const validateScanCountOrderQuantity = (orderQuantity, scanCount) => {
    const parsedScanCount = parsePositiveInt(scanCount, null);
    if (parsedScanCount == null || parsedScanCount <= 1) return { valid: true };

    const orderQty = parsePositiveInt(orderQuantity, null);
    if (orderQty !== 1) {
        return {
            valid: false,
            error: 'Invalid quantity for season pass ticket (must be 1)'
        };
    }
    return { valid: true };
};

export const findTicketTypeConfig = (event, ticketTypeId) => {
    if (!ticketTypeId || !Array.isArray(event?.ticketInfo)) return null;
    return event.ticketInfo.find(
        (t) => String(t?._id ?? t?.id ?? '') === String(ticketTypeId)
    ) ?? null;
};

/** True when checkout/seat map should treat an event as seated (venue map or pricing_configuration). */
export const eventHasSeatSelection = (event) => {
    if (!event) return false;
    if (event.isSeatedEvent === true) return true;
    const venue = event.venue;
    if (!venue || typeof venue !== 'object') return false;
    return !!(
        venue.venueId ||
        venue.hasSeatSelection === true ||
        venue.lockedManifestId ||
        venue.manifestS3Key ||
        venue.pricingModel === 'pricing_configuration'
    );
};

/** Remaining admission headcount for this ticket type, or null when not capped in Mongo. */
export const parseAvailableHeadcount = (ticketTypeConfig) => {
    if (!ticketTypeConfig || ticketTypeConfig.available == null) return null;
    const parsed = parseInt(String(ticketTypeConfig.available), 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, parsed);
};

export const shouldSkipTicketPoolInventoryCheck = (event, metadata = {}) => {
    if (event?.venue?.pricingModel === 'pricing_configuration') return true;

    const hasPlaceIds = metadata.placeIds && (
        (Array.isArray(metadata.placeIds) && metadata.placeIds.length > 0) ||
        (typeof metadata.placeIds === 'string' && metadata.placeIds.trim().length > 0 &&
            metadata.placeIds !== '[]' && metadata.placeIds !== 'null')
    );
    const hasSeatTickets = metadata.seatTickets && (
        (Array.isArray(metadata.seatTickets) && metadata.seatTickets.length > 0) ||
        (typeof metadata.seatTickets === 'string' && metadata.seatTickets.trim().length > 0 &&
            metadata.seatTickets !== '[]' && metadata.seatTickets !== 'null')
    );
    const seatedEvent = eventHasSeatSelection(event);
    return seatedEvent && (hasPlaceIds || hasSeatTickets);
};

export const resolveSeatCountFromPurchaseMetadata = (metadata = {}) => {
    const placeIds = metadata.placeIds;
    const placeCount = Array.isArray(placeIds)
        ? placeIds.length
        : (typeof placeIds === 'string' && placeIds.trim() ? 1 : 0);
    const seatTickets = metadata.seatTickets;
    const seatTicketCount = Array.isArray(seatTickets) ? seatTickets.length : 0;
    return Math.max(placeCount, seatTicketCount);
};

/**
 * Throws when remaining headcount is less than requested admissions.
 */
export const assertTicketInventoryAvailable = (ticketTypeConfig, admissionQuantity) => {
    const remaining = parseAvailableHeadcount(ticketTypeConfig);
    if (remaining == null) return;

    const needed = parsePositiveInt(admissionQuantity, null);
    if (needed == null) {
        const error = new Error('Invalid ticket quantity');
        error.code = 'INVALID_QUANTITY';
        throw error;
    }

    if (remaining < needed) {
        const error = new Error('INSUFFICIENT_TICKET_INVENTORY');
        error.code = 'INSUFFICIENT_TICKET_INVENTORY';
        error.remaining = remaining;
        error.requested = needed;
        throw error;
    }
};

export const formatInventoryErrorMessage = (err) => {
    if (err?.code === 'INSUFFICIENT_TICKET_INVENTORY') {
        const remaining = err.remaining ?? 0;
        const requested = err.requested ?? 0;
        return `Only ${remaining} ticket(s) remaining; your order requires ${requested}.`;
    }
    return err?.message || 'Ticket not available';
};

/**
 * Validates status + numeric pool for ticket_info purchases (not seat-map pricing_configuration).
 */
export const validateTicketPurchaseInventory = (event, ticketTypeConfig, options = {}) => {
    const { orderQuantity = 1, seatCount = 0, metadata = {} } = options;

    if (!ticketTypeConfig || shouldSkipTicketPoolInventoryCheck(event, metadata)) {
        return { admissionQuantity: Math.max(parsePositiveInt(seatCount, 0) || 0, 1), skipped: true };
    }

    const scanCount = getScanCountFromTicketType(ticketTypeConfig);
    const scanValidation = validateScanCountOrderQuantity(orderQuantity, scanCount);
    if (!scanValidation.valid) {
        const error = new Error(scanValidation.error);
        error.code = 'INVALID_QUANTITY';
        throw error;
    }

    const quantities = resolveTicketQuantities({
        orderQuantity,
        ticketTypeConfig,
        seatCount
    });

    assertTicketInventoryAvailable(ticketTypeConfig, quantities.admissionQuantity);
    return { admissionQuantity: quantities.admissionQuantity, quantities, skipped: false };
};
