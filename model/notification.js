(function () {

	var model = require('../model/mongoModel')
	const moment = require('moment')
	var root, createNotification, getAllNotification, updateNotificationById, getAllNotificationForWebsite,
		getNotificationByIdAndDate, getNotificationById, deleteNotificationById
	var Notification = (function () {

		function Notification(notificationType,notification, startDate, endDate, publish, lang) {
			this.notificationType = notificationType
			this.notification = notification
			this.startDate = startDate
			this.endDate = endDate
			this.publish = publish
			this.lang = lang
		}
		Notification.prototype.saveToDB = async function () {
			// body...
			var notification = new model.Notification({
				notificationType: this.notificationType,
				notification: this.notification,
				startDate: this.startDate,
				endDate: this.endDate,
				publish: this.publish,
				lang: this.lang

			}) 
			return await notification.save()
		}
		return Notification
	})()

	createNotification = async (notificationType, notification, startDate, endDate, publish, lang) => { 
		var notification = new Notification(notificationType, notification, startDate, endDate, publish, lang)
		return await notification.saveToDB()
	}
	getAllNotification = async () => {
		return await model.Notification.find().populate('notificationType').populate('notificationType').sort({ 'startDate': -1 }).limit(50).exec().catch(err=>{return {error:err.stack}})
	}

	updateNotificationById = async function (id, obj) {
		console.log(obj)
		return await model.Notification.findByIdAndUpdate(id, {
			$set: obj
		}, { new: true }).catch(err=>{return {error:err.stack}})
	}

	getAllNotificationForWebsite = async () => {
		const today = moment().startOf('day')
		return await model.Notification
			.find({ 'publish': true })
			.where({ 'startDate': { $gte:  today.toDate() } })
			.sort({ 'startDate': -1 })
			.populate('notificationType')
			.limit(50).catch(err=>{return {error:err.stack}})
	}
	getNotificationByIdAndDate = async (notification, startDate, endDate) => {
		return await model.Notification.findOne({ 'notification': notification, 'startDate': startDate, 'endDate': endDate }).exec().catch(err=>{return {error:err.stack}})
	}

	getNotificationById = async (id) => {
		return await model.Notification.findOne({ '_id': id }).populate('notificationType').exec().catch(err=>{return {error:err.stack}})
	}

	deleteNotificationById = async (id) => {
		return await model.Notification.findByIdAndRemove(id).catch(err=>{return {error:err.stack}})
	}
	root = typeof exports !== 'undefined' && exports !== null ? exports : window
	root.Notification = Notification
	root.getAllNotification = getAllNotification
	root.createNotification = createNotification
	root.updateNotificationById = updateNotificationById
	root.getAllNotificationForWebsite = getAllNotificationForWebsite
	root.getNotificationByIdAndDate = getNotificationByIdAndDate
	root.getNotificationById = getNotificationById
	root.deleteNotificationById = deleteNotificationById

}).call(this)