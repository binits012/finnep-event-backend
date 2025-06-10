import * as crypto from 'crypto'
import dotenv from 'dotenv'
dotenv.config()
import * as Crypto from '../model/crypto.js'
// Defining algorithm
const algorithm = 'aes-256-cbc';

export const createHashData = async (text, type) => {  
    const key =  crypto.scryptSync(process.env.CRYPTO_KEY,'salt',32)  
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv)
    // Updating text
    let encrypted = cipher.update(text)
    // Using concatenation
    encrypted = Buffer.concat([encrypted, cipher.final()])
    return await Crypto.createCrypto(iv.toString('hex'), type, encrypted.toString('hex'),text)

}

export const deleteHashById = async (id) => {
    return await Crypto.deleteCryptoById(id)
}

export const readHash = async (id) => {
    const myCrypto = await Crypto.readCryptoById(id) 
    const key =  crypto.scryptSync(process.env.CRYPTO_KEY,'salt',32)   
    const encryptedData = myCrypto.encryptedData
    let decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(myCrypto.iv,'hex'))
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
    decrypted += decipher.final('utf8') 
    const returnData = {
        _id: myCrypto.id,
        type: myCrypto.type,
        data: decrypted.toString()
    }
    return returnData
}

export const updateHash = async (id, text) => {
    const key =  crypto.scryptSync(process.env.CRYPTO_KEY,'salt',32)  
    const iv = crypto.randomBytes(16)
    let cipher =  crypto.createCipheriv(algorithm, key, iv) 
    let encrypted = cipher.update(text);

    // Using concatenation
    encrypted = Buffer.concat([encrypted, cipher.final()]) 
    return await Crypto.updateCryptoById(id,  iv.toString('hex'), encrypted.toString('hex'))

}

export const getCryptoByEmail = async (email) =>{
    return await Crypto.getCryptoByEmail(email)
} 

export const getCryptoBySearchIndex = async (data, dataType) =>{
    return await Crypto.getCryptoBySearchIndex(data, dataType)
}