import { Event } from '../../model/mongoModel.js';

export const TRUST_AUTO_PUBLISH_MIN = 1;
export const TRUST_AUTO_FEATURE_MIN = 5;
export const AUTO_FEATURE_DEFAULT_PRIORITY = 97;

/**
 * Count completed events for a merchant (trust signal).
 */
export async function countCompletedEvents(externalMerchantId) {
  if (externalMerchantId == null || externalMerchantId === '') {
    return 0;
  }
  return Event.countDocuments({
    externalMerchantId: String(externalMerchantId),
    status: 'completed',
  });
}

/**
 * Build temporary featured payload bounded to the event end date.
 */
export function buildAutoFeaturePayload({ eventEndDate, now = new Date() } = {}) {
  const endDate = eventEndDate ? new Date(eventEndDate) : null;
  return {
    isFeatured: true,
    featuredType: 'temporary',
    priority: AUTO_FEATURE_DEFAULT_PRIORITY,
    startDate: now,
    endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined,
    featuredAt: now,
    reason: 'auto-trust-policy',
    createdBy: 'system-trust-policy',
  };
}

/**
 * Resolve publish + feature policy from merchant status and completed-event count.
 *
 * @returns {{ active: boolean, featured: object|null, completedCount: number, tier: 0|1|2 }}
 */
export async function resolvePublishPolicy(merchant, externalMerchantId, { eventEndDate } = {}) {
  const completedCount = await countCompletedEvents(externalMerchantId);

  if (!merchant || merchant.status !== 'active') {
    return {
      active: false,
      featured: null,
      completedCount,
      tier: 0,
    };
  }

  if (completedCount >= TRUST_AUTO_FEATURE_MIN) {
    return {
      active: true,
      featured: buildAutoFeaturePayload({ eventEndDate }),
      completedCount,
      tier: 2,
    };
  }

  if (completedCount >= TRUST_AUTO_PUBLISH_MIN) {
    return {
      active: true,
      featured: null,
      completedCount,
      tier: 1,
    };
  }

  return {
    active: false,
    featured: null,
    completedCount,
    tier: 0,
  };
}
