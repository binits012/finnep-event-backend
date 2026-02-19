import * as Event from '../../model/event.js';
import { error, info } from '../../model/logger.js';
import { createPresaleToken } from '../../util/presaleToken.js';
import redisClient from '../../model/redisConnect.js';
import { loadPresaleLinkTemplate, loadSoldOutAvailableTemplate } from '../../util/common.js';
import { getEmailSubject } from '../../util/emailTranslations.js';

const PRESALE_LINK_TTL_HOURS = 24;
const DEFAULT_LOCALE = 'en-US';

/**
 * Send waitlist email via finnep-notification-service (HTTP) or fallback to sendMail.
 * @param {object} payload - { to, subject, html, type?: 'presale' | 'sold_out' }
 */
async function sendWaitlistEmail(payload) {
    const emailType = payload.type || 'presale';
    const baseUrl = process.env.NOTIFICATION_SERVICE_URL || process.env.FINNEP_NOTIFICATION_SERVICE_URL;
    if (baseUrl) {
        const url = baseUrl.replace(/\/$/, '') + '/send';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: payload.to,
                subject: payload.subject,
                html: payload.html,
                type: emailType
            })
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Notification service returned ${res.status}: ${text}`);
        }
        return;
    }
    const sendMail = await import('../../util/sendMail.js');
    await sendMail.forward({
        from: process.env.EMAIL_USERNAME,
        to: payload.to,
        subject: payload.subject,
        html: payload.html
    });
}

/**
 * Handle presale.send_emails or waitlist.send_emails from event-merchant-service.
 * Payload: data = { merchant_id, event_id, type?: 'pre_sale' | 'sold_out', emails: string[] }
 * - pre_sale (or legacy without type): 24h one-time token, presale link email.
 * - sold_out: "Tickets are available again" email with event link.
 */
export const handlePresaleSendEmails = async (message) => {
    const data = message?.data ?? message;
    const merchantId = data?.merchant_id ?? data?.merchantId;
    // Keep event_id as string for lookup (externalEventId in MongoDB); avoids JS number precision loss for large IDs
    const eventId = data?.event_id != null ? String(data.event_id) : (data?.eventId != null ? String(data.eventId) : null);
    const type = (data?.type === 'sold_out' ? 'sold_out' : 'pre_sale');
    const emails = Array.isArray(data?.emails) ? data.emails : [];

    if (!merchantId || !eventId || emails.length === 0) {
        error('[waitlistSendEmails] missing merchant_id, event_id or emails', { merchantId, eventId, emailsLength: emails.length });
        throw new Error('waitlist.send_emails: merchant_id, event_id and emails[] required');
    }

    const event = await Event.getEventByExternalIds(merchantId, eventId);
    if (!event) {
        error('[waitlistSendEmails] event not found', { merchantId, eventId });
        throw new Error('Event not found for merchant_id and event_id');
    }

    const doc = event._doc ?? event;
    const mongoEventId = String(doc._id ?? event._id);
    const eventTitle = doc.eventTitle || 'Event';
    const baseUrl = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://okazzo.eu').replace(/\/$/, '');
    const eventUrl = `${baseUrl}/events/${mongoEventId}`;

    const templateOptions = {
        eventPromotionalPhoto: doc.eventPromotionPhoto || doc.eventPromotionalPhoto || undefined
    };

    for (const email of emails) {
        const normalizedEmail = String(email).trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) continue;

        try {
            if (type === 'sold_out') {
                const subject = await getEmailSubject('sold_out_available', DEFAULT_LOCALE, { eventTitle });
                const html = await loadSoldOutAvailableTemplate(eventTitle, eventUrl, DEFAULT_LOCALE, templateOptions);
                await sendWaitlistEmail({ to: normalizedEmail, subject, html, type: 'sold_out' });
                info('[waitlistSendEmails] sold_out sent', { eventId: mongoEventId, email: normalizedEmail.slice(0, 3) + '…' });
            } else {
                const { token } = await createPresaleToken(redisClient, mongoEventId, normalizedEmail);
                const presaleLink = `${eventUrl}?presale=${token}`;
                const subject = await getEmailSubject('presale_link', DEFAULT_LOCALE, { eventTitle });
                const html = await loadPresaleLinkTemplate(eventTitle, presaleLink, PRESALE_LINK_TTL_HOURS, DEFAULT_LOCALE, templateOptions);
                await sendWaitlistEmail({ to: normalizedEmail, subject, html, type: 'presale' });
                info('[waitlistSendEmails] presale sent', { eventId: mongoEventId, email: normalizedEmail.slice(0, 3) + '…' });
            }
        } catch (err) {
            error('[waitlistSendEmails] failed for email', { type, email: normalizedEmail, err: err.message });
            throw err;
        }
    }
};
