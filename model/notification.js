import * as model from '../model/mongoModel.js'
import moment from 'moment' 
import {error} from './logger.js'

export class Notification {
	constructor(notificationType, notification, startDate, endDate, publish, lang) {
		this.notificationType = notificationType
		this.notification = notification
		this.startDate = startDate
		this.endDate = endDate
		this.publish = publish
		this.lang = lang
	}
	async saveToDB() {
		try{
			const notification = new model.Notification({
				notificationType: this.notificationType,
				notification: this.notification,
				startDate: this.startDate,
				endDate: this.endDate,
				publish: this.publish,
				lang: this.lang
			})
			return await notification.save()
		}catch(err){
			error('error creating notification %s', err.stack)
			throw err
		}
		
	}
}

export const createNotification = async (notificationType, notification, startDate, endDate, publish, lang) => { 
	var notification = new Notification(notificationType, notification, startDate, endDate, publish, lang)
	return await notification.saveToDB()
}
export const getAllNotification = async () => {
	return await model.Notification.find().populate('notificationType').populate('notificationType').sort({ 'startDate': -1 }).limit(50).exec().catch(err=>{return {error:err.stack}})
}

export const updateNotificationById = async function (id, obj) {
	console.log(obj)
	return await model.Notification.findByIdAndUpdate(id, {
		$set: obj
	}, { new: true }).catch(err=>{return {error:err.stack}})
}

export const getAllNotificationForWebsite = async () => {
	const today = moment().startOf('day')
	return await model.Notification
		.find({ 'publish': true })
		.where({ 'startDate': { $gte:  today.toDate() } })
		.sort({ 'startDate': -1 })
		.populate('notificationType')
		.limit(50).catch(err=>{return {error:err.stack}})
}
export const getNotificationByIdAndDate = async (notification, startDate, endDate) => {
	return await model.Notification.findOne({ 'notification': notification, 'startDate': startDate, 'endDate': endDate }).exec().catch(err=>{return {error:err.stack}})
}

export const getNotificationById = async (id) => {
	return await model.Notification.findOne({ '_id': id }).populate('notificationType').exec().catch(err=>{return {error:err.stack}})
}

export const deleteNotificationById = async (id) => {
	return await model.Notification.findByIdAndRemove(id).catch(err=>{return {error:err.stack}})
}