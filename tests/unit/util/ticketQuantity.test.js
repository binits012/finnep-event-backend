/**
 * Unit tests for ticketQuantity resolver
 */

import { describe, it, expect } from '@jest/globals';
import {
    getPackSizeFromTicketType,
    resolveTicketQuantities,
    applyTicketQuantitiesToTicketInfo,
    validateScanCountOrderQuantity,
    isSeasonPassTicketType,
    assertTicketInventoryAvailable,
    validateTicketPurchaseInventory
} from '../../../util/ticketQuantity.js';

describe('ticketQuantity', () => {
    describe('getPackSizeFromTicketType', () => {
        it('returns pack size for grouped ticket (available > quantity)', () => {
            expect(getPackSizeFromTicketType({ quantity: 3, available: 17 })).toBe(3);
        });

        it('returns 1 for standard pool ticket (available <= quantity)', () => {
            expect(getPackSizeFromTicketType({ quantity: 500, available: 455 })).toBe(1);
        });
    });

    describe('resolveTicketQuantities', () => {
        it('Group of 3 × order 1 → admission 3', () => {
            const result = resolveTicketQuantities({
                orderQuantity: 1,
                ticketTypeConfig: { quantity: 3, available: 17 }
            });
            expect(result.admissionQuantity).toBe(3);
            expect(result.orderQuantity).toBe(1);
            expect(result.packSize).toBe(3);
        });

        it('Group of 3 × order 2 → admission 6', () => {
            const result = resolveTicketQuantities({
                orderQuantity: 2,
                ticketTypeConfig: { quantity: 3, available: 17 }
            });
            expect(result.admissionQuantity).toBe(6);
        });

        it('standard multi-buy: order 9 → admission 9 (scanCount ignored)', () => {
            const result = resolveTicketQuantities({
                orderQuantity: 9,
                ticketTypeConfig: { quantity: 1, available: 50, scanCount: 1 }
            });
            expect(result.admissionQuantity).toBe(9);
            expect(result.orderQuantity).toBe(9);
        });

        it('season pass config does not inflate admission (order 1 → admission 1)', () => {
            const result = resolveTicketQuantities({
                orderQuantity: 1,
                ticketTypeConfig: { quantity: 1, available: 50, scanCount: 38 }
            });
            expect(result.admissionQuantity).toBe(1);
            expect(result.orderQuantity).toBe(1);
        });
    });

    describe('applyTicketQuantitiesToTicketInfo', () => {
        it('sets quantity and orderQuantity on ticketInfo', () => {
            const { ticketInfo } = applyTicketQuantitiesToTicketInfo(
                { eventName: 'Test' },
                { orderQuantity: 1, ticketTypeConfig: { quantity: 3, available: 17 } }
            );
            expect(ticketInfo.quantity).toBe('3');
            expect(ticketInfo.orderQuantity).toBe('1');
        });

        it('stores admission 9 for order 9', () => {
            const { ticketInfo } = applyTicketQuantitiesToTicketInfo(
                {},
                { orderQuantity: 9, ticketTypeConfig: { quantity: 1, available: 50, scanCount: 1 } }
            );
            expect(ticketInfo.quantity).toBe('9');
            expect(ticketInfo.orderQuantity).toBe('9');
        });
    });

    describe('validateScanCountOrderQuantity', () => {
        it('requires order quantity 1 only when scanCount > 1 (season pass)', () => {
            expect(validateScanCountOrderQuantity(2, 38).valid).toBe(false);
            expect(validateScanCountOrderQuantity(1, 38).valid).toBe(true);
        });

        it('allows multi-buy when scanCount is 0 or 1', () => {
            expect(validateScanCountOrderQuantity(9, 1).valid).toBe(true);
            expect(validateScanCountOrderQuantity(9, null).valid).toBe(true);
        });
    });

    describe('isSeasonPassTicketType', () => {
        it('true when scanCount > 1', () => {
            expect(isSeasonPassTicketType({ scanCount: 38 })).toBe(true);
        });
        it('false when scanCount is 1 or unset', () => {
            expect(isSeasonPassTicketType({ scanCount: 1 })).toBe(false);
            expect(isSeasonPassTicketType({})).toBe(false);
        });
    });

    describe('assertTicketInventoryAvailable', () => {
        it('rejects when remaining headcount is less than requested', () => {
            expect(() => {
                assertTicketInventoryAvailable({ available: 1 }, 100);
            }).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_TICKET_INVENTORY' }));
        });

        it('allows when enough headcount remains', () => {
            expect(() => {
                assertTicketInventoryAvailable({ available: 17 }, 3);
            }).not.toThrow();
        });

        it('skips check when available is not set', () => {
            expect(() => {
                assertTicketInventoryAvailable({ quantity: 3 }, 100);
            }).not.toThrow();
        });
    });

    describe('validateTicketPurchaseInventory', () => {
        const event = { ticketInfo: [{ _id: 't1', quantity: 3, available: 17 }] };
        const ticketType = { _id: 't1', quantity: 3, available: 17, status: 'available' };

        it('rejects 100 packs when only 17 admissions remain', () => {
            expect(() => {
                validateTicketPurchaseInventory(event, ticketType, {
                    orderQuantity: 100,
                    metadata: {}
                });
            }).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_TICKET_INVENTORY' }));
        });
    });
});
