import * as consts from '../const.js'
import * as  Photo from '../model/photo.js'
import * as  Notification from'../model/notification.js'
import * as  Event from'../model/event.js'
import * as  Setting from'../model/setting.js'

export const getDataForFront = async(req,res,next) =>{
    const photo = await Photo.listPhoto()
    const notification = await Notification.getAllNotification()
    let event = await Event.getEvents()
    if(event){
        event = event.filter(e=>e.active)
    }
    const setting = await Setting.getSetting()
    const data = {
        photo:photo,
        notification:notification,
        event:event,
        setting:setting
    }
    res.status(consts.HTTP_STATUS_OK).json(data)
} 