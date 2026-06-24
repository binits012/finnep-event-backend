
import { createTransport } from 'nodemailer'
import {error, info} from '../model/logger.js'
import dotenv from 'dotenv'
dotenv.config()
import {TicketReport} from '../model/reporting.js'

const EMAIL_SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS) || 15000;
const EMAIL_CONNECTION_TIMEOUT_MS = Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS) || 10000;

async function persistFailedEmail(emailData, retryCount = 0) {
    const reporting = TicketReport({
        emailData,
        isSend: false,
        retryCount,
    });
    await reporting.save();
}

function createMailTransport() {
    return createTransport({
        host: process.env.EMAIL_SERVER,
        port: process.env.EMAIL_PORT,
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD
        },
        tls: {
            chipers: 'SSLv3'
        },
        secure: false,
        ignoreTLS: false,
        connectionTimeout: EMAIL_CONNECTION_TIMEOUT_MS,
        greetingTimeout: EMAIL_CONNECTION_TIMEOUT_MS,
        socketTimeout: EMAIL_SEND_TIMEOUT_MS,
    });
}

let transport = createMailTransport();

async function sendWithTimeout(emailData, timeoutMs = EMAIL_SEND_TIMEOUT_MS) {
    const sendPromise = new Promise((resolve, reject) => {
        transport.sendMail(emailData, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
            () => reject(new Error(`Email send timed out after ${timeoutMs}ms`)),
            timeoutMs
        );
    });

    return Promise.race([sendPromise, timeoutPromise]);
}

export const forward = async (emailData, options = {}) => {
    if (!process.env.SEND_MAIL) return;

    const timeoutMs = options.timeoutMs ?? EMAIL_SEND_TIMEOUT_MS;

    try {
        const data = await sendWithTimeout(emailData, timeoutMs);
        info('email sent %s', data);
        return data;
    } catch (err) {
        await persistFailedEmail(emailData);
        error('error sending email %s', err?.stack || err?.message || String(err));
        throw err;
    }
};

export const forwardInBackground = (emailData, callbacks = {}) => {
    if (!process.env.SEND_MAIL) return;
    void forward(emailData).then((data) => {
        callbacks.onSuccess?.(data);
    }).catch((err) => {
        callbacks.onError?.(err);
    });
};

export const retryForward = async (id, emailData, retryCount) => {
    try {
        const data = await sendWithTimeout(emailData);
        info('email sent %s', data);
        return data;
    } catch (err) {
        await TicketReport.findByIdAndUpdate(id, { $set: { retryCount: retryCount + 1 } }, { new: true })
            .catch(updateErr => ({ error: updateErr.stack }));
        error('error sending email %s', err?.stack || err?.message || String(err));
        throw err;
    }
};

/**
 * Send pricing sync error email notification
 * @param {string} merchantEmail - Merchant email address
 * @param {string} eventId - Event ID
 * @param {string} eventTitle - Event title
 * @param {string|Error} errorMessageOrError - Error message string or Error object
 * @returns {Promise<void>}
 */
export const sendPricingSyncErrorEmail = async (merchantEmail, eventId, eventTitle, errorMessageOrError) => {
    if (!process.env.SEND_MAIL) {
        info('[sendPricingSyncErrorEmail] Email sending disabled, skipping notification');
        return;
    }

    // Check if merchant email is provided
    if (!merchantEmail || typeof merchantEmail !== 'string' || !merchantEmail.trim()) {
        error(`[sendPricingSyncErrorEmail] No recipient email provided for event ${eventId}. Skipping email.`);
        return;
    }

    try {
        // Handle both string and Error object
        const errorMessage = typeof errorMessageOrError === 'string'
            ? errorMessageOrError
            : (errorMessageOrError?.message || 'Unknown error');
        const errorStack = typeof errorMessageOrError === 'object' && errorMessageOrError?.stack
            ? errorMessageOrError.stack
            : '';

        const emailData = {
            from: process.env.EMAIL_USERNAME,
            to: merchantEmail,
            subject: `Pricing Configuration Sync Error - Event: ${eventTitle}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background-color: #dc3545; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
                        .content { background-color: #f8f9fa; padding: 20px; border-radius: 0 0 5px 5px; }
                        .error-box { background-color: #fff; border-left: 4px solid #dc3545; padding: 15px; margin: 15px 0; }
                        .footer { margin-top: 20px; font-size: 12px; color: #6c757d; }
                        .button { display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-top: 15px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h2>⚠️ Pricing Configuration Sync Error</h2>
                        </div>
                        <div class="content">
                            <p>Dear Merchant,</p>
                            <p>We encountered an error while syncing the pricing configuration for your event.</p>

                            <div class="error-box">
                                <strong>Event Details:</strong><br>
                                Event ID: ${eventId}<br>
                                Event Title: ${eventTitle}<br>
                                <br>
                                <strong>Error Message:</strong><br>
                                ${errorMessage}
                            </div>

                            <p><strong>What happened?</strong></p>
                            <p>The system attempted to sync your pricing configuration to the ticketing system, but encountered an error. This may be due to:</p>
                            <ul>
                                <li>Missing or invalid venue manifest data</li>
                                <li>Pricing data format issues</li>
                                <li>Network or service connectivity problems</li>
                            </ul>

                            <p><strong>What should you do?</strong></p>
                            <ol>
                                <li>Check that your venue manifest is properly configured</li>
                                <li>Verify that your pricing configuration is complete and valid</li>
                                <li>Try saving the pricing configuration again</li>
                                <li>If the issue persists, please contact support</li>
                            </ol>

                            <p>Your event update was processed successfully, but the pricing sync failed. You may need to manually trigger the pricing sync again.</p>

                            <div class="footer">
                                <p>This is an automated notification. Please do not reply to this email.</p>
                                <p>If you have questions, please contact support.</p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
Pricing Configuration Sync Error

Event ID: ${eventId}
Event Title: ${eventTitle}

Error Message: ${errorMessage}

What happened?
The system attempted to sync your pricing configuration to the ticketing system, but encountered an error.

What should you do?
1. Check that your venue manifest is properly configured
2. Verify that your pricing configuration is complete and valid
3. Try saving the pricing configuration again
4. If the issue persists, please contact support

Your event update was processed successfully, but the pricing sync failed. You may need to manually trigger the pricing sync again.

This is an automated notification. Please do not reply to this email.
            `
        };

        await forward(emailData);
        info(`[sendPricingSyncErrorEmail] Pricing sync error email sent to ${merchantEmail}`, {
            eventId,
            eventTitle,
            merchantEmail
        });
    } catch (err) {
        error(`[sendPricingSyncErrorEmail] Failed to send pricing sync error email:`, {
            error: err.message,
            stack: err.stack,
            merchantEmail,
            eventId,
            eventTitle
        });
        throw err;
    }
};

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * Alert platform ops when Stripe payment-success cannot load checkout snapshot.
 */
export const sendCheckoutSnapshotExpiredAdminEmail = async (adminEmail, details = {}) => {
    if (!process.env.SEND_MAIL) {
        info('[sendCheckoutSnapshotExpiredAdminEmail] Email sending disabled, skipping notification');
        return;
    }

    const recipient = String(adminEmail || '').trim();
    if (!recipient) {
        error('[sendCheckoutSnapshotExpiredAdminEmail] No admin recipient configured, skipping email');
        return;
    }

    const paymentIntentId = escapeHtml(details.paymentIntentId || 'unknown');
    const customerEmail = escapeHtml(details.customerEmail || 'unknown');
    const eventId = escapeHtml(details.eventId || 'unknown');
    const eventName = escapeHtml(details.eventName || '');
    const merchantId = escapeHtml(details.merchantId || '');
    const externalMerchantId = escapeHtml(details.externalMerchantId || '');
    const stripeStatus = escapeHtml(details.stripeStatus || 'not retrieved');
    const stripeAmount = details.stripeAmountCents != null
        ? `${(Number(details.stripeAmountCents) / 100).toFixed(2)} ${escapeHtml(details.stripeCurrency || '')}`.trim()
        : 'unknown';
    const clientId = escapeHtml(details.clientId || '');
    const placeIds = escapeHtml((details.placeIds || []).join(', ') || 'none');
    const stripeRetrieveError = details.stripeRetrieveError
        ? escapeHtml(details.stripeRetrieveError)
        : '';

    const emailData = {
        from: process.env.EMAIL_USERNAME,
        to: recipient,
        subject: `[Action required] Checkout snapshot missing — ${details.paymentIntentId || 'payment'}`,
        html: `
            <h2>Checkout snapshot missing at payment-success</h2>
            <p>A customer may have paid in Stripe but ticket fulfillment was blocked because the server checkout snapshot was not found in Redis.</p>
            <p><strong>Recommended action:</strong> verify the PaymentIntent in Stripe, then manually issue the ticket or process a refund.</p>
            <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
                <tr><td><strong>PaymentIntent ID</strong></td><td>${paymentIntentId}</td></tr>
                <tr><td><strong>Customer email</strong></td><td>${customerEmail}</td></tr>
                <tr><td><strong>Event ID</strong></td><td>${eventId}</td></tr>
                <tr><td><strong>Event name</strong></td><td>${eventName || '—'}</td></tr>
                <tr><td><strong>Merchant ID</strong></td><td>${merchantId || '—'} / ${externalMerchantId || '—'}</td></tr>
                <tr><td><strong>Stripe status</strong></td><td>${stripeStatus}</td></tr>
                <tr><td><strong>Stripe amount</strong></td><td>${stripeAmount}</td></tr>
                <tr><td><strong>Place IDs</strong></td><td>${placeIds}</td></tr>
                <tr><td><strong>Client</strong></td><td>${clientId || '—'}</td></tr>
                ${stripeRetrieveError ? `<tr><td><strong>Stripe lookup error</strong></td><td>${stripeRetrieveError}</td></tr>` : ''}
            </table>
            <p style="color:#666;font-size:12px;">Automated alert from Finnep Event App. Duplicate alerts for the same PaymentIntent are suppressed for 24h.</p>
        `,
        text: `
Checkout snapshot missing at payment-success

PaymentIntent ID: ${details.paymentIntentId || 'unknown'}
Customer email: ${details.customerEmail || 'unknown'}
Event ID: ${details.eventId || 'unknown'}
Event name: ${details.eventName || '—'}
Merchant ID: ${details.merchantId || '—'} / ${details.externalMerchantId || '—'}
Stripe status: ${details.stripeStatus || 'not retrieved'}
Stripe amount: ${details.stripeAmountCents != null ? `${Number(details.stripeAmountCents) / 100} ${details.stripeCurrency || ''}` : 'unknown'}
Place IDs: ${(details.placeIds || []).join(', ') || 'none'}
Client: ${details.clientId || '—'}
${details.stripeRetrieveError ? `Stripe lookup error: ${details.stripeRetrieveError}` : ''}

Recommended action: verify the PaymentIntent in Stripe, then manually issue the ticket or process a refund.
        `.trim(),
    };

    await forward(emailData);
    info('[sendCheckoutSnapshotExpiredAdminEmail] Admin alert sent', {
        paymentIntentId: details.paymentIntentId,
        recipient,
    });
};

/*
module.exports = {
    forward,
    retryForward,
    sendPricingSyncErrorEmail
}
*/
