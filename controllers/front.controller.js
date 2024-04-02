'use strict' 

const consts = require('../const')
const Photo = require('../model/photo')
const Notification = require('../model/notification')
const Event = require('../model/event')
const Setting = require('../model/setting')

const getDataForFront = async(req,res,next) =>{
    const photo = await Photo.listPhoto()
    const notification = await Notification.getAllNotification()
    const event = await Event.getEvents()
    const setting = await Setting.getSetting()
    const data = {
        photo:photo,
        notification:notification,
        event:event,
        setting:setting
    }
    res.status(consts.HTTP_STATUS_OK).json(data)
}
module.exports = {
    getDataForFront
}