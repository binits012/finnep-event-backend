
import * as model from '../model/mongoModel.js'
import * as CryptoLibrary from 'crypto'
import {error} from './logger.js'
const algorithm = 'aes-256-cbc'

export class Crypto {
    constructor(iv, type, encryptedData) {
        this.iv = iv;
        this.type = type;
        this.encryptedData = encryptedData;
    }
    async saveToDB() {
        try{
            const crypto = new model.Crypto({
                iv: this.iv,
                type: this.type,
                encryptedData: this.encryptedData
            });
            return await crypto.save();
        }catch(err){
            error('error creating crypto %s', err.stack)
            throw err
        }
        
    }
}

export const createCrypto = async ( iv, type, encryptedData) => {
    const crypto = new Crypto( iv, type, encryptedData)
    return await crypto.saveToDB()
}
export const deleteCryptoById = async (id) => {
    return await model.Crypto.deleteOne({ '_id': id }).catch(err=>{return {error:err.stack}})
}

export const readCryptoById = async (id) => {
    return await model.Crypto.findOne({ '_id': id }).catch(err=>{return {error:err.stack}})
}

export const updateCryptoById = async (id, iv, encryptedData) => {
    return await model.Crypto.findByIdAndUpdate(id, {
        $set: { 
            'iv': iv, 'encryptedData': encryptedData
        }
    }, { new: true }).catch(err=>{ 
        return err})
}

export const getCryptoByEmail = async (email) =>{
    const emailCryptos = await model.Crypto.find({'type':'email'}) 
    
    return emailCryptos.map(element => {
        const encryptedData = element.encryptedData
        const iv = element.iv
        const key =  CryptoLibrary.scryptSync(process.env.CRYPTO_KEY,'salt',32)   
        let decipher = CryptoLibrary.createDecipheriv(algorithm, key, Buffer.from(iv,'hex'))
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
        decrypted += decipher.final('utf8')  
        const emailCryto ={
            email:decrypted,
            _id:element._id

        } 
        return emailCryto 
    }).filter(e=>e.email === email)
    
} 