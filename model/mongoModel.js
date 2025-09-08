import * as mongoose from 'mongoose'
import * as bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()
import moment from 'moment-timezone'
import {convertDateTimeWithTimeZone} from '../util/common.js'
const Schema = mongoose.Schema
mongoose.set('strict', true);

// 1. First, define the audit plugin and schema
const auditTrailSchema = new mongoose.Schema({
	action: { 
		type: String, 
		enum: ['create', 'update', 'delete', 'restore', 'other'],
		required: true 
	},
	documentId: { 
		type: mongoose.Schema.Types.ObjectId, 
		required: true 
	},
	collectionName: { 
		type: String, 
		required: true 
	},
	user: { 
		type: mongoose.Schema.Types.ObjectId, 
		ref: 'User',
		required: false
	},
	before: mongoose.Schema.Types.Mixed,
	after: mongoose.Schema.Types.Mixed,
	createdAt: { type: Date, default: Date.now }
});

function auditPlugin(schema) {
	const debug = true;
	
	// Add modifiedBy field to all schemas that use the audit plugin
	schema.add({
		modifiedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: false
		}
	});

	// Add a method to set the user for the next operation
	schema.statics.setAuditUser = function(userId) {
		// Store the user ID in the model's options instead of a static property
		this._auditUser = userId;
		return this;
	};

	schema.pre('save', async function(next) {
		if (debug) console.log('Audit pre-save triggered for:', this.constructor.modelName);
		
		try {
			// Store the user ID from the model's options
			this._auditUser = this.constructor._auditUser;
			
			if (this.isNew) {
				if (debug) console.log('New document detected');
				this._auditAction = 'create';
				this._auditBefore = null;
			} else {
				if (debug) console.log('Existing document detected');
				this._auditAction = 'update';
				const originalDoc = await this.constructor.findById(this._id).lean();
				this._auditBefore = originalDoc;
			}
			next();
		} catch (err) {
			console.error('Pre-save audit error:', err);
			next(err);
		}
	});

	schema.post('save', true, async function(doc, next) {
		if (debug) console.log('Audit post-save triggered for:', doc.constructor.modelName);
		
		try {
			const auditEntry = new AuditTrail({
				action: this._auditAction || 'other',
				documentId: doc._id,
				collectionName: doc.constructor.modelName,
				user: doc.modifiedBy || this._auditUser || null, // Try to get user from multiple sources
				before: this._auditBefore,
				after: doc.toObject()
			});

			await auditEntry.save();
			if (debug) console.log('Audit entry created:', auditEntry._id);

			delete this._auditAction;
			delete this._auditBefore;
			delete this._auditUser;
			next();
		} catch (err) {
			console.error('Post-save audit error:', err);
			next();
		}
	});

	// Modify the update operations to handle user information
	schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], async function(next) {
		if (debug) console.log('Audit pre-update triggered');
		
		try {
			// Store the user ID from the model's options
			this._auditUser = this.model._auditUser;
			this._auditQuery = this.getQuery();
			this._auditBefore = await this.model.find(this._auditQuery).lean();
			next();
		} catch (err) {
			console.error('Pre-update audit error:', err);
			next(err);
		}
	});

	schema.post(['updateOne', 'updateMany', 'findOneAndUpdate'], async function(result) {
		if (debug) console.log('Audit post-update triggered');
		
		try {
			if (result && (result.modifiedCount > 0 || result._id)) {
				const updatedDocs = await this.model.find(this._auditQuery).lean();
				
				const auditPromises = updatedDocs.map(doc => {
					const beforeDoc = this._auditBefore?.find(d => 
						d._id.toString() === doc._id.toString()
					);
					
					return new AuditTrail({
						action: 'update',
						documentId: doc._id,
						collectionName: this.model.modelName,
						user: this.options?.modifiedBy || this._auditUser || null,
						before: beforeDoc,
						after: doc
					}).save();
				});

				await Promise.all(auditPromises);
				if (debug) console.log('Audit entries created for update');
			}
		} catch (err) {
			console.error('Post-update audit error:', err);
		}
	});
}

const roleSchema = new Schema({
	roleType: { type: String, unique: true },
	createdAt: { type: Date, default: Date.now }
})



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


const cryptoSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	iv: { type: String, required: true },
	encryptedData: { type: String, required: true },
	type: { type: String, required: true },
	searchHash: { type: String, required: true },
})

// Add compound index
cryptoSchema.index({ searchHash: 1, type: 1 });

const contactSchema = new Schema({
	user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	crypto: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }],
	streetName: { type: String, required: true },
	createdAt: { type: Date, default: Date.now }
})



const socialMediaSchema = new mongoose.Schema({
	name:{type:String, required:true, unique:true},
	active:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})



const eventTypeSchema = new mongoose.Schema({

	eventType: { type: String, required: true, unique: true },
	position: { type: Number, required: true },
	lang:{type:String, default:'en'},
	createdAt: { type: Date, default: Date.now }
})



const timeBasedPriceSchema = new mongoose.Schema({
	quantity:{ type: Number, required: true },
	title:{ type: String },
	price:{ type:Number, required: true },
	eventItem:{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
	active:{type:Boolean, default:true},
	activeUntil: { type: Date, required:true },
	createdAt: { type: Date, default: Date.now }
})


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
	},
	available: {
		type: Number, 
		min: [0, 'Available quantity cannot be negative']
	},
	serviceFee:{
		type: Number,
		default: 0,
		min: [0, 'Service fee cannot be negative']
	},
	vat:{
		type: Number,
		default: 0,
		min: [0, 'VAT cannot be negative']
	},
	status: {
		type: String,
		enum: ['available', 'low_stock', 'sold_out'],
		default: 'available'
	},
	createdAt: { type: Date, default: Date.now }
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
	active:{type:Boolean, default:false},
	eventName:{type:String,  unique:true},
	videoUrl:{type:String},
	status:{type:String, enum:['up-coming', 'on-going', 'completed'], default:'up-coming' },
	otherInfo:{
		type: mongoose.Schema.Types.Mixed
	},
	eventTimezone: { type: String },  
	city: { type: String },           
	country: { type: String },        
	venueInfo: {                      
		type: mongoose.Schema.Types.Mixed
	},
	externalMerchantId: { type: String, required: true, index: true },
	merchant:{ type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required:true },
	externalEventId: { type: String, required: true, index: true },
	createdAt: { type: Date, default: Date.now }
})
eventSchema.index({ externalMerchantId: 1, externalEventId: 1 }, { unique: true });

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

// Add pre-save hook to auto-increment position
eventSchema.pre('save', async function(next) {
  if (!this.position) {
    try {
      const lastEvent = await this.constructor.findOne().sort({ position: -1 });
      this.position = lastEvent ? lastEvent.position + 1 : 1;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

eventSchema.post('find', async (docs, next) =>{
	if(docs !== null && docs.length > 0){
		docs.forEach(async element => {
			element.eventDate =  new Date(await convertDateTimeWithTimeZone(element.eventDate)+'.000+00:00')
		});
	} 
	next()
})




const tokenSchema = new mongoose.Schema({
	token:{ type: String, required: true },
	userId:{type: String, required: true},
	isValid:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})



const notificationTypeSchema = new mongoose.Schema({
	name: {type:String, unique:true, required:true},
	publish:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
}) 


const notificationSchema = new mongoose.Schema({
	notification: { type: String, required: true },
	startDate: { type: Date },
	endDate: { type: Date },
	publish: { type: Boolean, default: true },
	lang: { type:String, default:'en'},
	notificationType: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationType', required:true },
	createdAt: { type: Date, default: Date.now }	
})




const photoTypeSchema = new Schema({
	name: { type: String, unique:true, required: true },
	publish:{ type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now }
})


const photoSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	photoLink: String,
	position: Number,
	publish:{ type:Boolean, default:true}, 
	photoType:[{type: mongoose.Schema.Types.ObjectId, ref: 'PhotoType', required:true}]
})



const messageReply = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	msgId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
	replyMsg:{type:String, required:true},
	replyFrom:{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }
})



const messageSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	msgFrom:{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' },
	msgTo:[{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }],
	msg:{ type:String, required:true },
	active:{type:Boolean, default:true},
	reply:[{type:mongoose.Schema.Types.ObjectId, ref:'Reply'}]
})


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
	validUntil:{type:Date},
	otp:{type:String, required:true}
})



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


 
const orderTicketSchema = mongoose.Schema({
	createdAt: { type: Date, default: Date.now }, 
	ticketInfo:{type:Map, of: mongoose.Schema.Types.Mixed},
	status:{type:String, enum:["created","in-complete","failed","completed","roundTripCompleted"], default:"created"},
	otp:{type:String, required:true},
	attempts: { type: Number, default: 0 },
	ticket: {type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
	updatedAt: { type: Date, default: Date.now },
})

const merchantSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	merchantId: { type: String, required: true, unique: true, index: true }, 
	name: { type: String, required: true },
	orgName: { type: String, unique: true },  
	country: { type: String },
	code: { type: String },
	email: { type: String },
	companyEmail: { type: String },  
	phone: { type: String },
	companyPhoneNumber: { type: String },  
	address: { type: String },
	companyAddress: { type: String },  
	schemaName: { type: String },  
	status: { type: String, enum: ["active", "inactive", "pending", "suspended"], default: "pending" },
	updatedAt: { type: Date, default: Date.now }
});

// Additional indexes for common search patterns
merchantSchema.index({ merchantId: 1 }); // Index on country code for filtering 

const outboxMessageSchema = new mongoose.Schema({
	createdAt: { type: Date, default: Date.now },
	messageId: { type: String, required: true, unique: true, index: true },
	exchange: { type: String, required: true },
	routingKey: { type: String, required: true },
	messageBody: { type: mongoose.Schema.Types.Mixed, required: true },
	headers: { type: Map, of: String },
	status: { 
		type: String, 
		enum: ["pending", "sent", "failed", "retrying"], 
		default: "pending" 
	},
	attempts: { type: Number, default: 0 },
	maxRetries: { type: Number, default: 3 },
	nextRetryAt: { type: Date },
	lastError: { type: String },
	sentAt: { type: Date },
	processedAt: { type: Date },
	correlationId: { type: String },
	eventType: { type: String, required: true },
	aggregateId: { type: String },
	version: { type: Number, default: 1 },
	updatedAt: { type: Date, default: Date.now }
});

// Indexes for efficient querying
outboxMessageSchema.index({ status: 1, nextRetryAt: 1 });
outboxMessageSchema.index({ eventType: 1, createdAt: -1 });
outboxMessageSchema.index({ correlationId: 1 });

const inboxMessageSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true, index: true }, // message_id
  eventType: { type: String },                                            // event_type
  aggregateId: { type: String },                                          // aggregate_id
  data: { type: mongoose.Schema.Types.Mixed },                            // data (jsonb)
  metadata: { type: mongoose.Schema.Types.Mixed },                        // metadata (jsonb)
  retryCount: { type: Number, default: 0 },                               // retry_count
  processed: { type: Boolean, default: false },                           // processed
  errorInfo: { type: String },                                            // error_info
  receivedAt: { type: Date, default: Date.now },                          // received_at
  processedAt: { type: Date },                                            // processed_at
  lastAttemptAt: { type: Date }                                           // last_attempt_at
});

// Indexes for efficient querying
inboxMessageSchema.index({ processed: 1, processedAt: 1 });
inboxMessageSchema.index({ eventType: 1, receivedAt: -1 });
inboxMessageSchema.index({ aggregateId: 1 });

inboxMessageSchema.plugin(auditPlugin);

// 3. Apply the audit plugin to all schemas BEFORE creating any models
const schemas = [
	inboxMessageSchema,
	outboxMessageSchema,
	merchantSchema, 
	orderTicketSchema,paymentSchema,settingSchema,ticketSchema,messageSchema,photoSchema,photoTypeSchema,
	notificationSchema,notificationTypeSchema,tokenSchema,eventSchema,timeBasedPriceSchema,eventTypeSchema,
	socialMediaSchema,contactSchema,cryptoSchema,roleSchema, userSchema
];

schemas.forEach(schema => {
	schema.plugin(auditPlugin);
});

// 4. Create the AuditTrail model first (since other models might reference it)
export const AuditTrail = mongoose.model('AuditTrail', auditTrailSchema);
export const InboxMessage = mongoose.model('InboxMessage', inboxMessageSchema);
export const OutboxMessage = mongoose.model('OutboxMessage', outboxMessageSchema);
export const OrderTicket = mongoose.model('OrderTicket',orderTicketSchema)
export const Payment = mongoose.model('Payment', paymentSchema)
export const Setting = mongoose.model('Setting', settingSchema)
export const Ticket = new mongoose.model('Ticket',ticketSchema)
export const Message = mongoose.model('Message',messageSchema)
export const Reply = new mongoose.model('Reply', messageReply)
export const Photo = mongoose.model('Photo', photoSchema)
export const PhotoType = mongoose.model('PhotoType', photoTypeSchema)
export const Notification = mongoose.model('Notification', notificationSchema)
export const NotificationType = mongoose.model('NotificationType', notificationTypeSchema)
export const JWTToken = mongoose.model('JWTToken', tokenSchema)
export const Event = mongoose.model('Event', eventSchema)
export const TimeBasedPrice = mongoose.model('TimeBasedPrice', timeBasedPriceSchema)
export const EventType = mongoose.model('EventType', eventTypeSchema)
export const SocialMedia = mongoose.model('SocialMedia', socialMediaSchema )
export const Contact = mongoose.model('Contact', contactSchema)
export const Crypto = mongoose.model('Crypto', cryptoSchema)
export const Role = mongoose.model('Role', roleSchema)
export const User = mongoose.model('User', userSchema)
export const Merchant = mongoose.model('Merchant', merchantSchema);