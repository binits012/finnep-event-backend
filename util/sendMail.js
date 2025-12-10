
import { createTransport } from 'nodemailer'
import {error, info} from '../model/logger.js'
import dotenv from 'dotenv'
dotenv.config()
import {TicketReport} from '../model/reporting.js'

let transport = createTransport({
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
    ignoreTLS: false

});


export const forward = async (emailData) =>{
    if(process.env.SEND_MAIL){
        try{
            return await new Promise((resolve, reject)=>{
                transport.sendMail(emailData, async function (err, data) {
                    if(err){
                        const msg ={
                            emailData: emailData,
                            isSend:false,
                            retryCount:0,
                        }
                        const reporting = TicketReport(msg)
                        await reporting.save()
                        error('error sending email %s', err)
                        reject(err)
                    }
                    info('email sent %s', data)
                    resolve(data)
                })
            })
        }catch(err){
            const msg ={
                emailData: emailData,
                isSend:false,
                retryCount:0,
            }
            const reporting = TicketReport(msg)
            await reporting.save()
            throw err
        }
    }

}

export const retryForward = async (id, emailData, retryCount) => {
    return await new Promise((resolve, reject)=>{
        transport.sendMail(emailData, async function (err, data) {
            if(err){
                const msg ={
                    retryCount:retryCount+1,
                }
                await TicketReport.findByIdAndUpdate(id, { $set:  msg },
                    { new: true }).catch(err=>{return {error:err.stack}})
                    error('error sending email %s', err)
                reject(err)
            }
            info('email sent %s', data)
            resolve(data)
        })
    })

}

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

/*
module.exports = {
    forward,
    retryForward,
    sendPricingSyncErrorEmail
}
*/
