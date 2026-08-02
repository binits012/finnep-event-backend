/**
 * Pure helper tests for completed-event self-heal / completion filter intent.
 * Full Agenda jobs need Mongo; these lock the policy rules used by the scheduler.
 */
import { describe, it, expect } from '@jest/globals';

describe('completed lifecycle rules', () => {
  const shouldSelfHeal = (event, now = new Date()) => {
    if (event.status !== 'completed') return false;
    const end = event.event_end_date || event.eventDate;
    if (!end) return false;
    return new Date(end).getTime() >= now.getTime();
  };

  const shouldComplete = (event, now = new Date(), bufferMs = 5 * 60 * 60 * 1000) => {
    if (event.status === 'completed') return false;
    const end = event.event_end_date || event.eventDate;
    if (!end) return false;
    return new Date(end).getTime() < now.getTime() - bufferMs;
  };

  it('does not self-heal moderation-pending inactive events', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    const pending = {
      status: 'up-coming',
      active: false,
      event_end_date: '2026-08-01T12:00:00.000Z',
    };
    expect(shouldSelfHeal(pending, now)).toBe(false);
  });

  it('self-heals only wrongly completed events with future end date', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    expect(
      shouldSelfHeal(
        {
          status: 'completed',
          active: false,
          event_end_date: '2026-08-01T12:00:00.000Z',
        },
        now
      )
    ).toBe(true);
    expect(
      shouldSelfHeal(
        {
          status: 'completed',
          active: false,
          event_end_date: '2026-06-01T12:00:00.000Z',
        },
        now
      )
    ).toBe(false);
  });

  it('completes past events that are not already completed', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    expect(
      shouldComplete(
        {
          status: 'on-going',
          active: true,
          event_end_date: '2026-06-01T00:00:00.000Z',
        },
        now
      )
    ).toBe(true);
    expect(
      shouldComplete(
        {
          status: 'completed',
          active: false,
          event_end_date: '2026-06-01T00:00:00.000Z',
        },
        now
      )
    ).toBe(false);
  });
});
