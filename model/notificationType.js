(function(){

    const model = require('./mongoModel')

    const NotificationType = (function(){
        function NotificationType(name){
            this.name = name
        }
        NotificationType.prototype.saveToDB = async function(){
            let notificationType = new model.NotificationType({
                name:this.name
            })
            return await notificationType.save()
        }
        return NotificationType
    })()

    const createNotificationType = async (name) =>{
        let noticationType = new NotificationType(name)
        return await noticationType.saveToDB()
    }

    const getNotificationTypes = async () =>{
        return await model.NotificationType.find({}).exec().catch(err=>{return {error:err.stack}})
    }

    const getNotificationTypeById = async (id) =>{
        return await model.NotificationType.find({_id:id}).exec().catch(err=>{return {error:err.stack}})
    }
    let root = typeof exports !== "undefined" && exports !== null ? exports : window;
    root.NotificationType = NotificationType
    root.getNotificationTypes = getNotificationTypes
    root.createNotificationType = createNotificationType
    root.getNotificationTypeById = getNotificationTypeById
}).call(this)