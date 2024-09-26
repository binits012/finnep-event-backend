import * as mongoose from 'mongoose'
import * as bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()
import moment from 'moment-timezone'
import {convertDateTimeWithTimeZone} from '../util/common.js'
const Schema = mongoose.Schema
mongoose.set('strict', true);

const roleSchema = new Schema({
	roleType: { type: String, unique: true },
	createdAt: { type: Date, default: Date.now }
})

export const Role = mongoose.model('Role', roleSchema)

const userSchema = new Schema({
	name: { type: String, required: true, unique: true, immutable: true, trim: true },
	pwd: { type: String, required: true },
	role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
	active: { type: Boolean, default: true },
	notificationAllowed:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})
userSchema.pre('save', function (next) {
	let user = this
	bcrypt.genSalt(Number(process.env.SALT_WORK_FACTOR), function (err, salt) {
	  if (err) {
		return next(err)
	  } else {
		bcrypt.hash(user.pwd, salt, function (err, hash) {
		  if (err) return next(err)
		  user.pwd = hash
		  next()
		})
	  }
	})
})

userSchema.methods.hashPassword = async function (userPassword) {
	const hashPassword = await bcrypt.genSalt(Number(process.env.SALT_WORK_FACTOR)).then(salt => {
	  if (salt) {
		return bcrypt.hash(userPassword, salt).then(hash => {
		  return hash;
		});
	  }
	}).catch(err => { return err });
	return hashPassword;
  };
  
userSchema.methods.comparePassword = async function (pwd) {
	return await bcrypt.compare(pwd, this.pwd);
}
export const User = mongoose.model('User', userSchema)

const CryptoSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	iv: { type: String, required: true },
	encryptedData: { type: String, required: true },
	type: { type: String, required: true }
})

export const Crypto = mongoose.model('Crypto', CryptoSchema)

const contactSchema = new Schema({
	user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	crypto: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }],
	streetName: { type: String, required: true },
	createdAt: { type: Date, default: Date.now }
})
export const Contact = mongoose.model('Contact', contactSchema)


const socialMediaSchema = new mongoose.Schema({
	name:{type:String, required:true, unique:true},
	active:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})

export const SocialMedia = mongoose.model('SocialMedia', socialMediaSchema )

const eventTypeSchema = new mongoose.Schema({

	eventType: { type: String, required: true, unique: true },
	position: { type: Number, required: true },
	lang:{type:String, default:'en'},
	createdAt: { type: Date, default: Date.now }
})

export const EventType = mongoose.model('EventType', eventTypeSchema)

const timeBasedPriceSchema = new mongoose.Schema({
	quantity:{ type: Number, required: true },
	title:{ type: String },
	price:{ type:Number, required: true },
	eventItem:{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
	active:{type:Boolean, default:true},
	activeUntil: { type: Date, required:true },
	createdAt: { type: Date, default: Date.now }
})
export const TimeBasedPrice = mongoose.model('TimeBasedPrice', timeBasedPriceSchema)

const ticketInfoSchema = new mongoose.Schema({
	name: {
	  type: String,
	  required: true, // Name is required
	},
	price: {
	  type: Number,
	  required: true, // Price is required
	  min: [0.01, 'Price must be a positive number']
	},
	quantity: {
	  type: Number,
	  required: true, // Quantity is required
	  min: [1, 'Quantity must be at least 1']
	}
})

const eventSchema = new mongoose.Schema({
	eventTitle: { type: String, required: true, unique: true },
	eventDescription: { type: String, required: true },
	eventDate: { type: Date, required: true },
	occupancy: {type: Number, required:true},
	ticketInfo: {
		type: [ticketInfoSchema],
		validate: {
		  validator: function(ticketInfoArray) {
			const size = ticketInfoArray.length
			 
			// Check for duplicate `name` fields
			const names = ticketInfoArray.map((item) => item.name);
			const uniqueNames = new Set(names);
			return  size > 0 && names.length === uniqueNames.size;
		  },
		  message: 'Duplicate entries found in ticketInfo array'
		}
	},
	lang:{type:String, default:'en'},
	socialMedia:{
		type: Map,
		of: String
	  },
	position:{type:Number},
	eventLocationAddress:{type:String},
	eventLocationGeoCode: {type:String},
	eventPromotionPhoto:{type:String},
	eventPhoto:[{type:String}],
	transportLink:{type:String},
	active:{type:Boolean, default:true},
	eventName:{type:String,  unique:true},
	videoUrl:{type:String},
	status:{type:String, enum:['up-coming', 'on-going', 'completed'], default:'up-coming' },
	createdAt: { type: Date, default: Date.now }
})

eventSchema.pre('findOneAndUpdate', function(next) {
	const update = this.getUpdate() 
	if (update && update.$set.ticketInfo) {
	  const ticketInfoArray = update.$set.ticketInfo
	  const names = ticketInfoArray.map(item => item.name)
	  const uniqueNames = new Set(names)
	  
	  if (names.length !== uniqueNames.size) {
		return next(new Error('Duplicate entries found in ticketInfoArray array'));
	  }
	}
	next()
})

eventSchema.pre('save', function(next){
	this.eventDate =  moment.utc(this.eventDate)
	next()
})

eventSchema.post('find', async (docs, next) =>{
	if(docs !== null && docs.length > 0){
		docs.forEach(async element => {
			element.eventDate =  new Date(await convertDateTimeWithTimeZone(element.eventDate)+'.000+00:00')
		});
	} 
	next()
})


export const Event = mongoose.model('Event', eventSchema)

const TokenSchema = new mongoose.Schema({
	token:{ type: String, required: true },
	userId:{type: String, required: true},
	isValid:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})
export const JWTToken = mongoose.model('JWTToken', TokenSchema)


const NotificationTypeSchema = new mongoose.Schema({
	name: {type:String, unique:true, required:true},
	publish:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
}) 
export const NotificationType = mongoose.model('NotificationType', NotificationTypeSchema)

const notificationSchema = new mongoose.Schema({
	notification: { type: String, required: true },
	startDate: { type: Date },
	endDate: { type: Date },
	publish: { type: Boolean, default: true },
	lang: { type:String, default:'en'},
	notificationType: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationType', required:true },
	createdAt: { type: Date, default: Date.now }	
})

export const Notification = mongoose.model('Notification', notificationSchema)


const photoTypeSchema = new Schema({
	name: { type: String, unique:true, required: true },
	publish:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})
export const PhotoType = mongoose.model('PhotoType', photoTypeSchema)

const photoSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	photoLink: String,
	position: Number,
	publish:{ type:Boolean, default:true}, 
	photoType:[{type: mongoose.Schema.Types.ObjectId, ref: 'PhotoType', required:true}]
})

export const Photo = mongoose.model('Photo', photoSchema)

const messageReply = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	msgId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
	replyMsg:{type:String, required:true},
	replyFrom:{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }
})

export const Reply = new mongoose.model('Reply', messageReply)

const messageSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	msgFrom:{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' },
	msgTo:[{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }],
	msg:{ type:String, required:true },
	active:{type:Boolean, default:true},
	reply:[{type:mongoose.Schema.Types.ObjectId, ref:'Reply'}]
})
export const Message = mongoose.model('Message',messageSchema)

const ticketSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	qrCode:{type:Buffer, default:null},
	ics:{type:Buffer, default:null},
	ticketFor:{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto', required:true },
	event:{type: mongoose.Schema.Types.ObjectId, ref: 'Event', required:true },
	isSend: {type:Boolean, required:true, default:false},
	active:{type:Boolean, required:true, default:true},
	isRead: {type:Boolean, required:true, default:false},
	readBy: {type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	readAt:{ type: Date },
	type:{type:String, default:'normal'},
	ticketInfo:{type:Map, of: mongoose.Schema.Types.Mixed},
	validUntil:{type:Date}
})
export const Ticket = new mongoose.model('Ticket',ticketSchema)


const settingSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	aboutSection:{ type: String },
	contactInfo:{
		type: Map,
		of: String
	  },
	socialMedia:{
		type: Map,
		of: String
	  }, 
	otherInfo:{
		type:Map,
		of:mongoose.Schema.Types.Mixed
	} 
})

export const Setting = mongoose.model('Setting', settingSchema)

const paymentSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	paymentInfo:{
		type:Map,
		of:mongoose.Schema.Types.Mixed
	},
	event:{type: mongoose.Schema.Types.ObjectId, ref: 'Event', required:true },
	ticket: {type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required:true },
	updatedAt: { type: Date, default: Date.now },
})

export const Payment = mongoose.model('Payment', paymentSchema)
 
const orderTicketSchema = mongoose.Schema({
	createdAt: { type: Date, default: Date.now }, 
	ticketInfo:{type:Map, of: mongoose.Schema.Types.Mixed},
	status:{type:String, enum:["created","in-complete","failed","completed","roundTripCompleted"], default:"created"},
	otp:{type:String, required:true},
	attempts: { type: Number, default: 0 },
	ticket: {type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
	updatedAt: { type: Date, default: Date.now },
})

export const OrderTicket = mongoose.model('OrderTicket',orderTicketSchema)