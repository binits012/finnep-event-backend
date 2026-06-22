import * as Event from '../../model/event.js';
import * as Merchant from '../../model/merchant.js';
import { error, info } from '../../model/logger.js';
import { createPresaleToken } from '../../util/presaleToken.js';
import redisClient from '../../model/redisConnect.js';
import { loadPresaleLinkTemplate, loadSoldOutAvailableTemplate } from '../../util/common.js';
import { getEmailSubject } from '../../util/emailTranslations.js';
import { normalizeSiloSettings } from '../../util/siloSettings.js';
import { isSiloSmtpConfigured, resolveSiloEmailBranding, resolveSiloPublicBaseUrl } from '../../util/siloEmailSettings.js';
import {
	sendSiloEmail,
	loadSiloPresaleLinkTemplate,
	loadSiloSoldOutAvailableTemplate,
	getSiloEmailSubject
} from '../../util/siloMail.js';

const PRESALE_LINK_TTL_HOURS = 24;
const DEFAULT_LOCALE = 'en-US';

async function sendPlatformWaitlistEmail(payload) {
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

function resolveEventBaseUrl(merchant, mongoEventId) {
    const siloBase = resolveSiloPublicBaseUrl(merchant);
    if (siloBase) {
        return `${siloBase}/events/${mongoEventId}`;
    }
    const baseUrl = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://okazzo.eu').replace(/\/$/, '');
    return `${baseUrl}/events/${mongoEventId}`;
}

function useSiloWaitlistEmail(merchant) {
    const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant;
    const silo = normalizeSiloSettings(obj?.siloSettings || {});
    return silo.enabled && silo.domain && isSiloSmtpConfigured(silo.email);
}

export const handlePresaleSendEmails = async (message) => {
    const data = message?.data ?? message;
    const merchantId = data?.merchant_id ?? data?.merchantId;
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

    const merchant = await Merchant.getMerchantByMerchantId(String(merchantId));
    const doc = event._doc ?? event;
    const mongoEventId = String(doc._id ?? event._id);
    const eventTitle = doc.eventTitle || 'Event';
    const eventUrl = resolveEventBaseUrl(merchant, mongoEventId);
    const siloMode = useSiloWaitlistEmail(merchant);
    const branding = siloMode ? resolveSiloEmailBranding(merchant) : null;

    const templateOptions = {
        eventPromotionalPhoto: doc.eventPromotionPhoto || doc.eventPromotionalPhoto || undefined
    };

    for (const email of emails) {
        const normalizedEmail = String(email).trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) continue;

        try {
            if (type === 'sold_out') {
                if (siloMode) {
                    const subject = await getSiloEmailSubject('sold_out_available', DEFAULT_LOCALE, { eventTitle });
                    const html = await loadSiloSoldOutAvailableTemplate(eventTitle, eventUrl, DEFAULT_LOCALE, branding, templateOptions);
                    await sendSiloEmail(merchant, { to: normalizedEmail, subject, html });
                } else {
                    const subject = await getEmailSubject('sold_out_available', DEFAULT_LOCALE, { eventTitle });
                    const html = await loadSoldOutAvailableTemplate(eventTitle, eventUrl, DEFAULT_LOCALE, templateOptions);
                    await sendPlatformWaitlistEmail({ to: normalizedEmail, subject, html, type: 'sold_out' });
                }
                info('[waitlistSendEmails] sold_out sent', { eventId: mongoEventId, email: normalizedEmail.slice(0, 3) + '…', siloMode });
            } else {
                const { token } = await createPresaleToken(redisClient, mongoEventId, normalizedEmail);
                const presaleLink = `${eventUrl}?presale=${token}`;
                if (siloMode) {
                    const subject = await getSiloEmailSubject('presale_link', DEFAULT_LOCALE, { eventTitle });
                    const html = await loadSiloPresaleLinkTemplate(eventTitle, presaleLink, PRESALE_LINK_TTL_HOURS, DEFAULT_LOCALE, branding, templateOptions);
                    await sendSiloEmail(merchant, { to: normalizedEmail, subject, html });
                } else {
                    const subject = await getEmailSubject('presale_link', DEFAULT_LOCALE, { eventTitle });
                    const html = await loadPresaleLinkTemplate(eventTitle, presaleLink, PRESALE_LINK_TTL_HOURS, DEFAULT_LOCALE, templateOptions);
                    await sendPlatformWaitlistEmail({ to: normalizedEmail, subject, html, type: 'presale' });
                }
                info('[waitlistSendEmails] presale sent', { eventId: mongoEventId, email: normalizedEmail.slice(0, 3) + '…', siloMode });
            }
        } catch (err) {
            error('[waitlistSendEmails] failed for email', { type, email: normalizedEmail, err: err.message });
            throw err;
        }
    }
};
