const Crypto = require('../model/crypto') 
require('../model/dbConnect')


const getCryptoByEmail = async(email) =>{
    await Crypto.getCryptoByEmail(email).then(data=>{
        console.log(data)
    })
}

getCryptoByEmail('binit.shrestha@finnep.fi')