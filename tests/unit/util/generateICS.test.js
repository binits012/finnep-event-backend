import { describe, it, expect } from '@jest/globals';
import { generateICS } from '../../../util/common.js';

describe('generateICS', () => {
    it('uses event eventTimezone (IANA TZID) and local wall time from the UTC instant', async () => {
        const event = {
            eventDate: new Date('2026-06-15T12:00:00.000Z'),
            eventTimezone: 'Europe/Helsinki',
            eventTitle: 'Summer show',
            eventDescription: 'Live',
            eventLocationAddress: 'Helsinki',
            eventLocationGeoCode: '60.17,24.94'
        };
        const ics = await generateICS(event, 'ticket_uid_1');
        expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(ics.includes('\n') && !ics.includes('\r\n')).toBe(false);
        // June = EEST (UTC+3): 12:00Z → 15:00 in Helsinki
        expect(ics).toMatch(/DTSTART;TZID=Europe\/Helsinki:20260615T150000/);
        expect(ics).not.toContain('DTSTART:20260615T120000Z');
        expect(ics).toContain('BEGIN:VTIMEZONE');
        expect(ics).toContain('TZID:Europe/Helsinki');
    });

    it('emits DTEND with same TZID when eventEndDate is after start', async () => {
        const event = {
            eventDate: new Date('2026-06-15T12:00:00.000Z'),
            eventEndDate: new Date('2026-06-15T14:30:00.000Z'),
            eventTimezone: 'Europe/Helsinki',
            eventTitle: 'Summer show',
            eventDescription: 'Live',
            eventLocationAddress: 'Helsinki'
        };
        const ics = await generateICS(event, 'ticket_uid_2');
        expect(ics).toMatch(/DTSTART;TZID=Europe\/Helsinki:20260615T150000/);
        // 14:30Z → 17:30 Helsinki (EEST)
        expect(ics).toMatch(/DTEND;TZID=Europe\/Helsinki:20260615T173000/);
    });

    it('omits geo when coordinates are missing or invalid', async () => {
        const event = {
            eventDate: new Date('2026-06-15T12:00:00.000Z'),
            eventTitle: 'No geo',
            eventDescription: '',
            eventLocationAddress: 'Somewhere'
        };
        const ics = await generateICS(event, 'ticket_uid_3');
        expect(ics).not.toContain('GEO:');
    });

    it('prefers event.eventTimezone over venue.timezone', async () => {
        const event = {
            eventDate: new Date('2026-06-15T12:00:00.000Z'),
            eventTimezone: 'Europe/Helsinki',
            venue: { timezone: 'America/New_York' },
            eventTitle: 'TZ priority',
            eventDescription: '',
            eventLocationAddress: 'X'
        };
        const ics = await generateICS(event, 'ticket_uid_4');
        expect(ics).toMatch(/DTSTART;TZID=Europe\/Helsinki:20260615T150000/);
        expect(ics).not.toMatch(/DTSTART;TZID=America\/New_York/);
    });

    it('uses venue.timezone when event has no eventTimezone', async () => {
        const event = {
            eventDate: new Date('2026-06-15T12:00:00.000Z'),
            venue: { timezone: 'America/New_York' },
            eventTitle: 'Venue TZ',
            eventDescription: '',
            eventLocationAddress: 'NYC'
        };
        const ics = await generateICS(event, 'ticket_uid_5');
        // June: EDT (UTC−4): 12:00Z → 08:00 local
        expect(ics).toMatch(/DTSTART;TZID=America\/New_York:20260615T080000/);
        expect(ics).toContain('TZID:America/New_York');
    });
});
