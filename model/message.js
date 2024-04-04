(function(){

    const model = require('./mongoModel')
    const logger = require('./logger')

    const Message = (function(){
        const Message = function Message(msgFrom, msg, reply){
            this.msgFrom = msgFrom
            this.msg = msg
            this.reply = reply
        }

        Message.prototype.saveToDB = async()=>{
            const message = new model.Message({
                msgFrom:this.msgFrom,
                msg:this.msg,
                reply:this.reply
            })
            await message.save()
        }
        return Message

    })()

    const createMessage = async(msgFrom, msg, reply=[])=>{

        const message = new Message(msgFrom, msg, reply)
        return await message.saveToDB()
         
    }

    const getMessage = async() =>{
        return await model.Message.find().exec().catch(err=>{
            logger.log('error', err.stack)
            return err.stack
        })
    }

    const getMessageById = async(id) =>{
        return await model.Message.find({_id:id}).exec().catch(err=>{
            logger.log('error', err.stack)
            return err.stack
        })
    }

    const updateMessageById = async(id, obj) =>{
        return await model.Message.findOneAndUpdate({_id:id}, {
			$set:  obj,
		}, { new: true }).catch(err=>{
            logger.log('error', err.stack)
            return err
        })
    } 
    let root = typeof exports !== "undefined" && exports !== null ? exports : window
    root.Message = Message
    root.createMessage = createMessage
    root.getMessage = getMessage
    root.getMessageById = getMessageById
    root.updateMessageById = updateMessageById
}).call(this)