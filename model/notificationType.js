import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class NotificationType {
    constructor(name) {
        this.name = name
    }
    async saveToDB() {
        try{
            const notificationType = new model.NotificationType({
                name: this.name
            })
            return await notificationType.save()
        }catch(err){
            error('error creating notification type %s', err.stack)
            throw err
        }
        
    }
}
export const createNotificationType = async (name) =>{
    let noticationType = new NotificationType(name)
    return await noticationType.saveToDB()
}

export const getNotificationTypes = async () =>{
    return await model.NotificationType.find({}).exec().catch(err=>{return {error:err.stack}})
}

export const getNotificationTypeById = async (id) =>{
    return await model.NotificationType.find({_id:id}).exec().catch(err=>{return {error:err.stack}})
}
