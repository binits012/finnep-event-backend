const jwt = require('jsonwebtoken')
require('dotenv').config()
const logger = require('../model/logger')

const redis = require('redis');
const redisClient = redis.createClient({
	port: process.env.REDIS_PORT,
	host: process.env.REDIS_HOST,
    no_ready_check: true,
    password:process.env.REDIS_PWD
})
redisClient.connect().catch(console.error)
redisClient.on('error', function (error) {
	console.error(error);
});
const commonUtil = require('../util/common')
const JWTToken = require('../model/token')

const generateJWT = async (userData, cb) => {
  jwt.sign(userData, process.env.JWT_TOKEN_SECRET, {
    expiresIn: process.env.TOKEN_LIFE_SPAN,
  },  async(error, token) =>{
    //insert created token into db
    return await JWTToken.createToken(token, userData.id).then(data =>{ 
        commonUtil.setCacheByKey(redisClient, userData.id, data)
        cb(error, data.token)
    }).catch(err =>{
        console.log(err)
        cb(err, null)
    }) 
  })   
}

const generateReservationBasedJWT = async (userData, cb) =>{
    const key = userData.id
    jwt.sign(userData, process.env.JWT_TOKEN_SECRET, {
        expiresIn: process.env.TOKEN_LIFE_SPAN,
      },  async(error, token) =>{ 
        
        const data = {
            token:token,
            userId:userData.id,
            isValid:true,
            _id: key
        }
        commonUtil.setCacheByKey(redisClient, key, data)
        cb(error, token) 
      })
}

const verifyJWT = async (token, cb) => {
    if (!token) return false
    try {
        const myToken = token.replace("Bearer ", "")
        jwt.verify(myToken, process.env.JWT_TOKEN_SECRET, async(err, data) => { 
            if(err){ 
                cb(err, null) 
                return
            }
            //check integrity of the token
            const userId = data.id  
            const cacheData =  await commonUtil.getCacheByKey(redisClient, userId) 
             
            if(cacheData === null) { 
                cb(null, null)
                return
            }
            else if(cacheData.isValid && myToken === cacheData.token ){
                cb(err, data)
            }else{
                cb(err, null)
            }  
        });

    } catch (e) { 
        logger.log('error',e.message)
        cb(err, null)
    }
}

const invalidateJWT = async (token, cb) =>{ 
    try{
        jwt.verify(token.replace("Bearer ", ""),process.env.JWT_TOKEN_SECRET, async(err, data) => { 
            const id = data.id
            await commonUtil.removeCacheByKey(redisClient,id).catch(err=>{return err})  
            await JWTToken.removeTokenByUserId(id).catch(err=>{return err})
            cb(err,data)
        })
    }catch(err){
        cb(err, null)
    }
}

const invalidateReservationBasedJWT = async (id) => { 
    await commonUtil.removeCacheByKey(redisClient,id).catch(err=>{return err}) 
           
}
module.exports = {
    generateJWT,
    verifyJWT,
    invalidateJWT,
    generateReservationBasedJWT,
    invalidateReservationBasedJWT
}
