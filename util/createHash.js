import * as crypto from 'crypto'
import dotenv from 'dotenv'
dotenv.config()
import * as Crypto from '../model/crypto.js'

// Defining algorithm
const algorithm = 'aes-256-cbc';
const SALT = process.env.CRYPTO_SALT || 'finnep-default-salt-2024'; // Configurable salt with fallback
const KEY_LENGTH = 32;

// Cache the derived keys to avoid recomputing them every time
let cachedNewKey = null;
let cachedOldKey = null;

const getDerivedKey = (useOldSalt = false) => {
    if (!process.env.CRYPTO_KEY) {
        throw new Error('CRYPTO_KEY environment variable is required');
    }
    
    if (useOldSalt) {
        if (!cachedOldKey) {
            cachedOldKey = crypto.scryptSync(process.env.CRYPTO_KEY, 'salt', KEY_LENGTH);
        }
        return cachedOldKey;
    } else {
        if (!cachedNewKey) {
            cachedNewKey = crypto.scryptSync(process.env.CRYPTO_KEY, SALT, KEY_LENGTH);
        }
        return cachedNewKey;
    }
};

export const createHashData = async (text, type) => {  
    try {
        if (!text || !type) {
            throw new Error('Text and type are required parameters');
        }
        
        const key = getDerivedKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        // Encrypt the text
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return await Crypto.createCrypto(iv.toString('hex'), type, encrypted, text);
    } catch (error) {
        console.error('Error in createHashData:', error);
        throw new Error(`Failed to create hash data: ${error.message}`);
    }
}

export const deleteHashById = async (id) => {
    return await Crypto.deleteCryptoById(id)
}

export const readHash = async (id) => {
    try {
        if (!id) {
            throw new Error('ID is required parameter');
        }
        
        const myCrypto = await Crypto.readCryptoById(id);
        if (!myCrypto) {
            throw new Error('Crypto record not found');
        }
        
        // Try new salt first, then fallback to old salt for backward compatibility
        const salts = [false, true]; // false = new salt, true = old salt
        
        for (const useOldSalt of salts) {
            try {
                const key = getDerivedKey(useOldSalt);
                const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(myCrypto.iv, 'hex'));
                
                let decrypted = decipher.update(myCrypto.encryptedData, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                
                // If we get here, decryption was successful
                return {
                    _id: myCrypto._id,
                    type: myCrypto.type,
                    data: decrypted
                };
            } catch (decryptError) {
                // Continue to next salt if this one fails
                if (useOldSalt) {
                    // If both salts fail, throw the error
                    throw decryptError;
                }
                // Try next salt
            }
        }
    } catch (error) {
        console.error('Error in readHash:', error);
        throw new Error(`Failed to read hash: ${error.message}`);
    }
}

export const updateHash = async (id, text) => {
    try {
        if (!id || !text) {
            throw new Error('ID and text are required parameters');
        }
        
        const key = getDerivedKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return await Crypto.updateCryptoById(id, iv.toString('hex'), encrypted);
    } catch (error) {
        console.error('Error in updateHash:', error);
        throw new Error(`Failed to update hash: ${error.message}`);
    }
}

export const getCryptoByEmail = async (email) => {
    try {
        if (!email) {
            throw new Error('Email is required parameter');
        }
        return await Crypto.getCryptoByEmail(email);
    } catch (error) {
        console.error('Error in getCryptoByEmail:', error);
        throw new Error(`Failed to get crypto by email: ${error.message}`);
    }
} 

export const getCryptoBySearchIndex = async (data, dataType) => {
    try {
        if (!data || !dataType) {
            throw new Error('Data and dataType are required parameters');
        }
        return await Crypto.getCryptoBySearchIndex(data, dataType);
    } catch (error) {
        console.error('Error in getCryptoBySearchIndex:', error);
        throw new Error(`Failed to get crypto by search index: ${error.message}`);
    }
}

// Migration utility to re-encrypt data with new salt
export const migrateCryptoData = async (batchSize = 100) => {
    try {
        console.log('Starting crypto data migration...');
        
        // Get all crypto records
        const allCrypto = await Crypto.getAllCryptoRecords();
        let migrated = 0;
        let failed = 0;
        
        for (let i = 0; i < allCrypto.length; i += batchSize) {
            const batch = allCrypto.slice(i, i + batchSize);
            
            for (const cryptoRecord of batch) {
                try {
                    // Try to decrypt with old salt
                    const oldKey = getDerivedKey(true); // useOldSalt = true
                    const decipher = crypto.createDecipheriv(algorithm, oldKey, Buffer.from(cryptoRecord.iv, 'hex'));
                    
                    let decrypted = decipher.update(cryptoRecord.encryptedData, 'hex', 'utf8');
                    decrypted += decipher.final('utf8');
                    
                    // Re-encrypt with new salt
                    const newKey = getDerivedKey(false); // useOldSalt = false
                    const iv = crypto.randomBytes(16);
                    const cipher = crypto.createCipheriv(algorithm, newKey, iv);
                    
                    let reEncrypted = cipher.update(decrypted, 'utf8', 'hex');
                    reEncrypted += cipher.final('hex');
                    
                    // Update the record
                    await Crypto.updateCryptoById(cryptoRecord._id, iv.toString('hex'), reEncrypted);
                    migrated++;
                    
                } catch (error) {
                    console.error(`Failed to migrate crypto record ${cryptoRecord._id}:`, error);
                    failed++;
                }
            }
            
            console.log(`Processed batch ${Math.floor(i / batchSize) + 1}, migrated: ${migrated}, failed: ${failed}`);
        }
        
        console.log(`Migration completed. Migrated: ${migrated}, Failed: ${failed}`);
        return { migrated, failed };
        
    } catch (error) {
        console.error('Error in migrateCryptoData:', error);
        throw new Error(`Failed to migrate crypto data: ${error.message}`);
    }
}