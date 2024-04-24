import * as model from '../model/mongoModel.js' 
import {error} from './logger.js'

export class Message {
    constructor(msgFrom, msg, reply) {
        this.msgFrom = msgFrom
        this.msg = msg
        this.reply = reply
    }
    async saveToDB() {
        try{
            const message = new model.Message({
                msgFrom: this.msgFrom,
                msg: this.msg,
                reply: this.reply
            })
            return await message.save()
        }catch(err){
            error('error creating message %s', err.stack)
            throw err
        }
        
    }
}

export const createMessage = async(msgFrom, msg, reply=[])=>{

    const message = new Message(msgFrom, msg, reply)
    return await message.saveToDB()
     
}

export const getMessage = async() =>{
    return await model.Message.find().exec().catch(err=>{
        error('error getting message %s', err.stack)
        throw err.stack
    })
}

export const getMessageById = async(id) =>{
    return await model.Message.find({_id:id}).exec().catch(err=>{
        error('error getting message by id %s', err.stack)
        throw err.stack
    })
}

export const updateMessageById = async(id, obj) =>{
    return await model.Message.findOneAndUpdate({_id:id}, {
        $set:  obj,
    }, { new: true }).catch(err=>{
        error('error updating message by id', err.stack)
        throw err
    })
} 
 