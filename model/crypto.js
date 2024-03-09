(function () { 
    const model = require('../model/mongoModel')
    const CryptoLibrary = require('crypto')
    const algorithm = 'aes-256-cbc'
    var root, createCrypto, deleteCryptoById, updateCryptoById, readCryptoById, updateCryptoById,getCryptoByEmail
    var Crypto = (function () {

        function Crypto(iv, type, encryptedData) { 
            this.iv = iv
            this.type = type
            this.encryptedData = encryptedData
        }

        Crypto.prototype.saveToDB = async function () {
            var crypto = new model.Crypto({ 
                iv: this.iv,
                type: this.type,
                encryptedData: this.encryptedData
            });
            return await crypto.save()
        };
        return Crypto;
    })();

    createCrypto = async ( iv, type, encryptedData) => {
        const crypto = new Crypto( iv, type, encryptedData)
        return await crypto.saveToDB()
    }
    deleteCryptoById = async (id) => {
        return await model.Crypto.deleteOne({ '_id': id }).catch(err=>{return {error:err.stack}})
    }

    readCryptoById = async (id) => {
        return await model.Crypto.findOne({ '_id': id }).catch(err=>{return {error:err.stack}})
    }

    updateCryptoById = async (id, iv, encryptedData) => {
        return await model.Crypto.findByIdAndUpdate(id, {
            $set: { 
                'iv': iv, 'encryptedData': encryptedData
            }
        }, { new: true }).catch(err=>{ 
            return err})
    }

    getCryptoByEmail = async (email) =>{
        const emailCryptos = await model.Crypto.find({'type':'email'}) 
        return emailCryptos.map(element => {
            const encryptedData = element.encryptedData
            const iv = element.iv
            const key =  CryptoLibrary.scryptSync(process.env.CRYPTO_KEY,'salt',32)   
            let decipher = CryptoLibrary.createDecipheriv(algorithm, key, Buffer.from(iv,'hex'))
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
            decrypted += decipher.final('utf8')  
            return decrypted 
        })
        
    }
    root = typeof exports !== 'undefined' && exports !== null ? exports : window
    root.Crypto = Crypto
    root.createCrypto = createCrypto
    root.deleteCryptoById = deleteCryptoById
    root.readCryptoById = readCryptoById
    root.updateCryptoById = updateCryptoById
    root.getCryptoByEmail = getCryptoByEmail
}).call(this)
