import {info, error, warn} from '../../model/logger.js'; // Adjust path as needed
import { createMerchant, getMerchantByMerchantId, updateMerchantById } from '../../model/merchant.js';
import { inboxModel } from '../../model/inboxMessage.js';
import { loadEmailTemplateForMerchant } from '../../util/common.js';
import { forward } from '../../util/sendMail.js';
import dotenv from 'dotenv'
dotenv.config()
import { dirname } from 'path'
const __dirname = dirname(import.meta.url).slice(7)

export const handleMerchantMessage = async (message) => {
    // Add message validation and better logging
    info('Processing merchant message', {
        messageType: typeof message,
        messageKeys: message ? Object.keys(message) : [],
        type: message?.type,
        routingKey: message?.routingKey,
        merchantId: message?.merchantId,
        fullMessage: message
    });

    // Validate message structure
    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object: %s', { message });
        throw new Error('Message must be an object');
    }

    const messageId = message?.metaData?.causationId;

    // Check if message has already been processed (idempotency)
    if (messageId && await inboxModel.isProcessed(messageId)) {
        console.log(`Message ${messageId} already processed, skipping...`);
        return;
    }

    // Try to save message, but handle duplicate key error gracefully
    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.type || message.routingKey,
            aggregateId: message.merchantId,
            data: message,
            metadata: message.data?.metaData || { receivedAt: new Date() }
        });
    } catch (saveError) {
        // If it's a duplicate key error, check if the message was already processed
        if (saveError.code === 11000 && messageId) {
            const isAlreadyProcessed = await inboxModel.isProcessed(messageId);
            if (isAlreadyProcessed) {
                console.log(`Message ${messageId} already processed, skipping...`);
                return;
            }
        }
        // Re-throw if it's not a duplicate key error or message wasn't processed
        throw saveError;
    }

    // Handle both 'type' and 'routingKey' fields for compatibility
    const messageType = message.type || message.routingKey;

    if (!messageType) {
        error('Message missing required "type" or "routingKey" field: %s', { message });
        throw new Error('Message must have a "type" or "routingKey" field');
    }

    try {
        switch (messageType) {
            case 'merchant.created':
                await handleMerchantCreated(message);
                break;
            case 'merchant.updated':
                await handleMerchantUpdated(message);
                break;
            default:
                warn('Unknown merchant message type', {
                    type: messageType,
                    availableTypes: ['merchant.created', 'merchant.updated'],
                    fullMessage: message
                });
                throw new Error(`Unknown message type: ${messageType}`);
        }
    } catch (err) {
        error('Error handling merchant message %s', {
            type: messageType,
            error: err.message,
            stack: err.stack,
            merchantId: message?.merchantId,
            fullMessage: message
        });
        throw err;
    }
};

async function handleMerchantCreated(message) {
    info('Creating merchant', { merchantId: message.merchantId, orgName: message.orgName });

    try {
        // Validate required fields
        if (!message.merchantId) {
            throw new Error('merchantId is required');
        }

        // Use orgName as fallback for name if name is not provided
        const name = message.name || message.orgName;
        if (!name) {
            throw new Error('Either name or orgName is required');
        }

        const merchantData = {
            merchantId: message.merchantId,
            name: name,
            orgName: message.orgName,
            country: message.country,
            code: message.code,
            email: message.email,
            companyEmail: message.companyEmail,
            phone: message.phone,
            companyPhoneNumber: message.companyPhoneNumber,
            address: message.address,
            companyAddress: message.companyAddress,
            schemaName: message.schemaName,
            website: message.website,
            logo: message.logo,
            stripeAccount: message.stripeAccount
        };

        await createMerchant(merchantData);
        //now its time to send the email to the merchant
        await sendMerchantArrivalEmail(message.orgName, message.merchantId, message.email, message.companyEmail);
        info('Merchant created successfully', { merchantId: message.merchantId });
        await inboxModel.markProcessed(message?.metaData?.causationId);
    } catch (err) {
        // Handle duplicate merchant gracefully - treat as success (idempotent)
        if (err.code === 11000 && err.message.includes('merchantId')) {
            info('Merchant already exists, treating as successful (idempotent)', {
                merchantId: message.merchantId
            });
            // Mark as processed to prevent infinite retries
            await inboxModel.markProcessed(message?.metaData?.causationId);
            return; // Don't throw, just return successfully
        }

        error('Failed to create merchant', {
            merchantId: message.merchantId,
            error: err.message
        });
        throw err;
    }
}

async function handleMerchantUpdated(message) {
    info('Updating merchant', { merchantId: message.merchantId, orgName: message.orgName });

    try {
        const merchant = await getMerchantByMerchantId(message.merchantId);

        if (!merchant) {
            throw new Error(`Merchant not found: ${message.merchantId}`);
        }

        const updateData = { ...message };
        delete updateData.merchantId; // Don't update the ID field
        delete updateData.type;
        delete updateData.routingKey;

        // needs sanitization
        await updateMerchantById(merchant._id, updateData);
        await inboxModel.markProcessed(message?.metaData?.causationId);

        info('Merchant updated successfully', { merchantId: message.merchantId });
    } catch (err) {
        error('Failed to update merchant', {
            merchantId: message.merchantId,
            error: err.message
        });
        throw err;
    }
}

async function handleMerchantActivated(message) {
    info('Activating merchant', { merchantId: message.merchantId });

    try {
        const merchant = await getMerchantByMerchantId(message.merchantId);

        if (!merchant) {
            throw new Error(`Merchant not found: ${message.merchantId}`);
        }

        await updateMerchantById(merchant._id, {
            status: 'active',
            activatedAt: new Date()
        });

        info('Merchant activated successfully', { merchantId: message.merchantId });
    } catch (err) {
        error('Failed to activate merchant', {
            merchantId: message.merchantId,
            error: err.message
        });
        throw err;
    }
}

async function handleMerchantDeactivated(message) {
    info('Deactivating merchant', { merchantId: message.merchantId });

    try {
        const merchant = await getMerchantByMerchantId(message.merchantId);

        if (!merchant) {
            throw new Error(`Merchant not found: ${message.merchantId}`);
        }

        await updateMerchantById(merchant._id, {
            status: 'inactive',
            deactivatedAt: new Date()
        });

        info('Merchant deactivated successfully', { merchantId: message.merchantId });
    } catch (err) {
        error('Failed to deactivate merchant', {
            merchantId: message.merchantId,
            error: err.message
        });
        throw err;
    }
}

async function sendMerchantArrivalEmail(orgName, merchantId, merchantEmail, companyEmail) {
    const fileLocation = __dirname.replace('rabbitMQ/handlers', '') +'/emailTemplates/merchant_arrival.html';
    const dashboardUrl = process.env.DASHBOARD_URL  + merchantId + '/login';
    const emailPayload = await loadEmailTemplateForMerchant(fileLocation, orgName, dashboardUrl);
    const message = {
        from:process.env.EMAIL_USERNAME,
        to:merchantEmail,
        cc:companyEmail,
        subject:'Welcome to the Finnep',
        html:emailPayload.toString(),

    }
    await forward(message);
}

export { handleMerchantCreated, handleMerchantUpdated, handleMerchantActivated, handleMerchantDeactivated };
