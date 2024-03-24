'use strict' 

const consts = require('../const')
const Photo = require('../model/photo')
const Notification = require('../model/notification')

const getDataForFront = async(req,res,next) =>{
    const photo = await Photo.listPhoto()
    const notification = await Notification.getAllNotification()
    const data = {
        photo:photo,
        notification:notification
    }
    res.status(consts.HTTP_STATUS_OK).json(data)
}
module.exports = {
    getDataForFront
}