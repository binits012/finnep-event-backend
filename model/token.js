import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class JWTToken {
    constructor(token, userId){
        this.token = token
        this.userId = userId
    }
    async saveToDB(){
        try{
            const jwtToken = new model.JWTToken({
                token: this.token,
                userId: this.userId 
            });
    
            return await jwtToken.save()
        }catch(err){
            error(' error generating Token %s', err.stack)
            throw err
        }
        
    }
}
export const createToken = async function (token, userId) { 
    const tokenByUserId = await getTokenByUserId(userId)  
    if(tokenByUserId === undefined || tokenByUserId === null){
        //let's add the token to db
        const jwtToken = new JWTToken(token, userId)
        return await jwtToken.saveToDB()
    }else{
        // let's update the existing entry 
       return await updateTokenByUserId(tokenByUserId.userId, token, true)
    }
}
export const getTokenByUserId = async (userId) =>{ 
    return await model.JWTToken.findOne({userId:userId}).exec().catch(err=>{return err})
}
export const updateTokenByUserId = async (userId, token, isValid) =>{
    return await model.JWTToken.findOneAndUpdate({userId:userId}, {
        $set: {
            'token': token, 'isValid': isValid   
        }
    }, { new: true }).catch(err=>{return {error:err.stack}})
}
export const removeTokenByUserId = async (userId) =>{
    return await model.JWTToken.deleteOne({userId:userId})
}
 