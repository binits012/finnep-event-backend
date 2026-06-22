import {info, error, warn} from '../../model/logger.js'; // Adjust path as needed
import { createMerchant, getMerchantByMerchantId, updateMerchantById } from '../../model/merchant.js';
import { inboxModel } from '../../model/inboxMessage.js';
import { loadEmailTemplateForMerchant } from '../../util/common.js';
import { normalizeSiloSettings, mergeSiloSettingsFromEmsSync } from '../../util/siloSettings.js';
import { normalizeMerchantSocialMedia } from '../../util/merchantSocialMedia.js';
import { forward } from '../../util/sendMail.js';
import dotenv from 'dotenv'
dotenv.config()
import { dirname } from 'path'
import { isNepalCountry } from '../../util/nepalPayment.js';
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
            stripeAccount: message.stripeAccount,
            nabilEnabled: Boolean(message.nabilEnabled ?? message.nabil_enabled) || isNepalCountry(message.country),
        };

        const bankingInfoUpdate = buildBankingInfoUpdate(message, null);
        if (bankingInfoUpdate !== null && Object.keys(bankingInfoUpdate).length > 0) {
            merchantData.bankingInfo = bankingInfoUpdate;
        }

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

const BANKING_FIELDS = ['bank_name', 'bic_swift', 'bank_account', 'bank_address', 'account_holder_name'];

function bankingInfoToObject(bankingInfo) {
    if (!bankingInfo) return {};
    if (bankingInfo instanceof Map) {
        return Object.fromEntries(bankingInfo);
    }
    return { ...bankingInfo };
}

/**
 * Build bankingInfo update from EMS orginfo fields (null clears a key; all null clears the map).
 * @returns {object|null} null when message carries no bank fields
 */
function buildBankingInfoUpdate(message, existingMerchant) {
    const fieldsInMessage = BANKING_FIELDS.filter((field) => message[field] !== undefined);
    if (fieldsInMessage.length === 0) {
        return null;
    }

    if (fieldsInMessage.every((field) => message[field] === null)) {
        return {};
    }

    const merged = bankingInfoToObject(existingMerchant?.bankingInfo);
    BANKING_FIELDS.forEach((field) => {
        if (message[field] === null) {
            delete merged[field];
        } else if (message[field] !== undefined && message[field] !== null) {
            merged[field] = message[field];
        }
    });

    return merged;
}

function toPlainObject(value) {
	if (!value) return {}
	if (typeof value.toObject === 'function') return value.toObject()
	if (value instanceof Map) return Object.fromEntries(value)
	return { ...value }
}

function parseSiloSettingsRaw(raw) {
	if (raw == null) return null
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw)
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
		} catch {
			return null
		}
	}
	if (typeof raw === 'object' && !Array.isArray(raw)) return raw
	return null
}

async function handleMerchantUpdated(message) {
    const merchantId = message.merchantId != null ? String(message.merchantId) : null;
    info('Updating merchant', { merchantId, orgName: message.orgName });

    try {
        if (!merchantId) {
            throw new Error('merchantId is required');
        }

        const merchant = await getMerchantByMerchantId(merchantId);

        if (!merchant) {
            throw new Error(`Merchant not found: ${merchantId}`);
        }

        const updateData = {};
        const scalarFields = [
            'name', 'orgName', 'country', 'code', 'companyEmail', 'companyPhoneNumber',
            'address', 'companyAddress', 'schemaName', 'status', 'website', 'logo'
        ];

        scalarFields.forEach((field) => {
            if (message[field] !== undefined && message[field] !== null) {
                updateData[field] = message[field];
            }
        });

        // EMS orginfo column is `name`; Mongo uses both name and orgName
        if (message.name !== undefined && message.name !== null) {
            updateData.name = message.name;
            if (message.orgName === undefined || message.orgName === null) {
                updateData.orgName = message.name;
            }
        }

        // EMS orginfo publishes stripe_account (snake_case); Mongo uses stripeAccount
        const stripeAccount = message.stripeAccount ?? message.stripe_account;
        if (stripeAccount !== undefined && stripeAccount !== null) {
            updateData.stripeAccount = stripeAccount;
        }

        const nabilEnabled = message.nabilEnabled ?? message.nabil_enabled;
        if (nabilEnabled !== undefined && nabilEnabled !== null) {
            updateData.nabilEnabled = Boolean(nabilEnabled);
        }

        const bankingInfoUpdate = buildBankingInfoUpdate(message, merchant);
        if (bankingInfoUpdate !== null) {
            updateData.bankingInfo = bankingInfoUpdate;
        }

        const siloSettingsRaw = parseSiloSettingsRaw(message.siloSettings ?? message.silo_settings)
        if (siloSettingsRaw) {
            const existingSilo = toPlainObject(merchant.siloSettings)
            updateData.siloSettings = mergeSiloSettingsFromEmsSync(siloSettingsRaw, existingSilo)
        }

        const socialMediaRaw = message.socialMedia ?? message.social_media;
        if (socialMediaRaw !== undefined && socialMediaRaw !== null) {
            updateData.socialMedia = normalizeMerchantSocialMedia(socialMediaRaw);
        }

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

async function sendMerchantArrivalEmail(orgName, merchantId, merchantEmail, companyEmail, locale = 'en-US') {
    const fileLocation = __dirname.replace('rabbitMQ/handlers', '') +'/emailTemplates/merchant_arrival.html';
    const dashboardUrl = process.env.DASHBOARD_URL  + merchantId + '/login';
    const emailPayload = await loadEmailTemplateForMerchant(fileLocation, orgName, dashboardUrl, locale);
    const { getEmailSubject } = await import('../../util/emailTranslations.js');
    const emailSubject = await getEmailSubject('merchant_arrival', locale);
    const message = {
        from:process.env.EMAIL_USERNAME,
        to:merchantEmail,
        cc:companyEmail,
        subject:emailSubject,
        html:emailPayload.toString(),

    }
    await forward(message);
}

export { handleMerchantCreated, handleMerchantUpdated, handleMerchantActivated, handleMerchantDeactivated };
