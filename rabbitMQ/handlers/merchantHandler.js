import {info, error, warn} from '../../model/logger.js'; // Adjust path as needed
import { createMerchant, getMerchantByMerchantId, updateMerchantById } from '../../model/merchant.js';
import { inboxModel } from '../../model/inboxMessage.js'; 

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
        error('Invalid message format - not an object %s', { message });
        throw new Error('Message must be an object');
    }
    await inboxModel.saveMessage({
        messageId: message?.metaData?.causationId,
        eventType: message.type || message.routingKey,
        aggregateId: message.merchantId,
        data: message,
        metadata: message.data?.metaData || { receivedAt: new Date() }
    });

    // Handle both 'type' and 'routingKey' fields for compatibility
    const messageType = message.type || message.routingKey;
    
    if (!messageType) {
        error('Message missing required "type" or "routingKey" field' %s  , { message });
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
            schemaName: message.schemaName
        };
        
        await createMerchant(merchantData);
        
        info('Merchant created successfully', { merchantId: message.merchantId });
        await inboxModel.markProcessed(message?.metaData?.causationId);
    } catch (err) {
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

export { handleMerchantCreated, handleMerchantUpdated, handleMerchantActivated, handleMerchantDeactivated };
