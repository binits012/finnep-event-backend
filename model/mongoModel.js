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
	const debug = process.env.AUDIT_DEBUG == 'true' || false;
	console.log('Audit debug:', debug);
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
	  required: true, // Price is required (basePrice)
	  min: [0, 'Price cannot be negative'] // Allow 0 for free events
	},
	quantity: {
	  type: Number,
	  required: true, // Quantity is required
	  min: [0, 'Quantity cannot be negative'] // Allow 0 for free events
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
	// Entertainment tax (percentage on basePrice) - e.g., 14% in Finland
	entertainmentTax:{
		type: Number,
		default: 0,
		min: [0, 'Entertainment tax cannot be negative'],
		max: [100, 'Entertainment tax cannot exceed 100%']
	},
	// Service tax/VAT (percentage on serviceFee) - e.g., 25.5% in Finland
	serviceTax:{
		type: Number,
		default: 0,
		min: [0, 'Service tax cannot be negative'],
		max: [100, 'Service tax cannot exceed 100%']
	},
	// Order fee (fixed amount per transaction)
	orderFee:{
		type: Number,
		default: 0,
		min: [0, 'Order fee cannot be negative']
	},
	// Legacy VAT field - kept for backward compatibility
	// Note: serviceTax should be used instead for seat-based events
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
	eventTitle: { type: String, required: true },
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
	eventName:{type:String},
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
	venue:{
		type: mongoose.Schema.Types.Mixed,
		// Structure when hasSeatSelection is true:
		// {
		//   venueId: String,           // MongoDB venue ID
		//   externalVenueId: String,   // External venue ID
		//   hasSeatSelection: Boolean, // Whether seat selection is enabled
		//   pricingModel: String,       // Pricing model: 'ticket_info' or 'pricing_configuration' (required when hasSeatSelection is true)
		//   lockedManifestId: ObjectId, // Reference to locked manifest
		//   manifestS3Key: String,      // S3 key for locked manifest
		//   pricing: Map<Number>       // Section/zone pricing config
		// }
		// Structure when hasSeatSelection is false:
		// {
		//   pricingModel: String        // Defaults to 'ticket_info' (optional)
		// }
	},
	// Featured and positioning system
	featured: {
		isFeatured: { type: Boolean, default: false },
		featuredType: {
			type: String,
			enum: ['sticky', 'temporary'],
			default: 'temporary'
		},
		priority: { type: Number, default: 0 }, // Higher number = higher priority
		startDate: { type: Date }, // When featuring starts (for temporary)
		endDate: { type: Date }, // When featuring ends (for temporary)
		featuredAt: { type: Date, default: Date.now }
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt:{ type:Date, default:Date.now }
})
eventSchema.index({ externalMerchantId: 1, externalEventId: 1 }, { unique: true });
// Featured events indexes
eventSchema.index({ 'featured.isFeatured': 1, 'featured.priority': -1});
eventSchema.index({ 'featured.isFeatured': 1, 'featured.featuredType': 1, 'featured.startDate': 1, 'featured.endDate': 1 });
eventSchema.index({ 'featured.isFeatured': 1, 'featured.endDate': 1 }); // For cleanup of expired temporary features

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

	// Validate pricingModel when hasSeatSelection is being set to true
	if (update && update.$set && update.$set['venue.hasSeatSelection'] === true) {
		const pricingModel = update.$set['venue.pricingModel'];
		if (!pricingModel || (pricingModel !== 'ticket_info' && pricingModel !== 'pricing_configuration')) {
			return next(new Error('pricingModel must be set to either "ticket_info" or "pricing_configuration" when hasSeatSelection is true'));
		}
	} else if (update && update.$set && update.$set['venue.hasSeatSelection'] === false) {
		// Default to 'ticket_info' when hasSeatSelection is set to false
		if (!update.$set['venue.pricingModel']) {
			update.$set['venue.pricingModel'] = 'ticket_info';
		}
	}

	next()
})

eventSchema.pre('save', function(next){
	this.eventDate =  moment.utc(this.eventDate)

	// Validate pricingModel when hasSeatSelection is true
	if (this.venue && this.venue.hasSeatSelection === true) {
		if (!this.venue.pricingModel || (this.venue.pricingModel !== 'ticket_info' && this.venue.pricingModel !== 'pricing_configuration')) {
			return next(new Error('pricingModel must be set to either "ticket_info" or "pricing_configuration" when hasSeatSelection is true'));
		}
	} else if (this.venue && this.venue.hasSeatSelection === false) {
		// Default to 'ticket_info' when hasSeatSelection is false
		if (!this.venue.pricingModel) {
			this.venue.pricingModel = 'ticket_info';
		}
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
	merchant:{type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required:true},
	externalMerchantId:{type:String, required:true},
	otp:{type:String, required:true, unique:true},

	// Payment provider tracking
	paymentProvider: {
		type: String,
		enum: ['stripe', 'paytrail', 'free'],
		default: 'stripe'
	},
	paytrailTransactionId: { type: String }, // Paytrail transaction ID
	paytrailStamp: { type: String }, // Paytrail stamp (reference)
	paytrailSubMerchantId: { type: String } // Sub-merchant for this transaction
})

// Add indexes for Paytrail transaction lookups
ticketSchema.index({ paytrailTransactionId: 1 });
ticketSchema.index({ paytrailSubMerchantId: 1 });



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
	website: { type: String },
	logo: { type: String },
	stripeAccount: { type: String, required: true },

	// Paytrail Shop-in-Shop configuration
	paytrailEnabled: {
		type: Boolean,
		default: false,
		// Admin controls this via CMS
	},
	paytrailSubMerchantId: {
		type: String,
		// Sub-merchant ID from Paytrail shop-in-shop
		// Format: "13466" (numeric string)
		unique: true,
		sparse: true // Allow null for merchants without Paytrail
	},
	paytrailShopInShopData: {
		// Additional shop-in-shop metadata
		subMerchantName: { type: String },
        commissionRate: {
            type: Number,
            default: function() {
                // Use function to access process.env at runtime
                return parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '4');
            },
            min: 0,
            max: 100
        }, // Platform commission % - configurable per merchant
		createdAt: { type: Date },
		status: {
			type: String,
			enum: ['pending', 'active', 'suspended'],
			default: 'pending'
		}
	},

	bankingInfo: { type:Map,
		of:mongoose.Schema.Types.Mixed },
	otherInfo:{
		type:Map,
		of:mongoose.Schema.Types.Mixed
	},
	updatedAt: { type: Date, default: Date.now }
});

// Additional indexes for common search patterns
merchantSchema.index({ merchantId: 1 }); // Index on country code for filtering
merchantSchema.index({ paytrailSubMerchantId: 1 }); // Index for Paytrail lookups

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


const ticketAnalyticsSchema = new mongoose.Schema({
	merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true },
	externalMerchantId: { type: String, required: true },
	event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },

	totalTickets: { type: Number, default: 0 },
	totalRevenue: { type: Number, default: 0 }, // Derived from ticketInfo.price

	ticketTypes: [{
	  type: { type: String }, // From ticket.type
	  count: { type: Number },
	  revenue: { type: Number }
	}],

	ticketInfoStats: {
	  categories: { type: Map, of: Number }, // e.g., { 'VIP': 12, 'General': 88 }
	  extras: { type: Map, of: Number },     // e.g., { 'parking': 30 }
	  seatsSold: { type: Number }            // If seat info is present in ticketInfo
	},

	processedTicketIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }], // Track processed tickets

	firstSale: { type: Date },
	lastSale: { type: Date },
	lastUpdated: { type: Date, default: Date.now }
  });

const externalTicketSalesSchema = new mongoose.Schema({
	eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
	externalEventId: { type: String, required: true, index: true },
	merchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true },
	externalMerchantId: { type: String, required: true },
	ticketType: { type: String, required: true },
	quantity: { type: Number, required: true, min: 0 },
	unitPrice: { type: Number, required: true, min: 0 },
	saleDate: { type: Date, required: true },
	source: {
		type: String,
		enum: ['door_sale', 'other'],
		required: true
	},
	paymentMethod: { type: String }, // e.g., 'cash', 'card', 'mobile'
	currency: { type: String, default: 'EUR' },
	messageId: { type: String, unique: true, index: true }, // For idempotency
	receivedAt: { type: Date, default: Date.now },
	createdAt: { type: Date, default: Date.now }
});

// Compound indexes for efficient queries
externalTicketSalesSchema.index({ eventId: 1, source: 1 });
externalTicketSalesSchema.index({ externalEventId: 1, source: 1 });

// Venue Schema
const venueSchema = new mongoose.Schema({
	name: { type: String, required: true },
	venueType: {
		type: String,
		enum: ['stadium', 'theater', 'arena', 'general', 'custom'],
		required: true
	},
	merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' }, // Optional - venues can exist without merchant association
	externalVenueId: { type: String, index: true },
	// Location/Address properties
	address: { type: String }, // Street address
	city: { type: String }, // City name
	state: { type: String }, // State/Province/Region
	country: { type: String, index: true }, // Country name
	postalCode: { type: String }, // Postal/ZIP code
	// Geographic coordinates
	coordinates: {
		latitude: { type: Number }, // Latitude in decimal degrees
		longitude: { type: Number }, // Longitude in decimal degrees
		geocode: { type: String } // Geocoded address string (from Nominatim or similar)
	},
	// Timezone for the venue location
	timezone: { type: String }, // IANA timezone (e.g., 'Europe/Helsinki', 'America/New_York')
	// Contact information
	phone: { type: String }, // Venue phone number
	email: { type: String }, // Venue email
	website: { type: String }, // Venue website URL
	// Description
	description: { type: String }, // Venue description
	dimensions: {
		width: { type: Number },
		height: { type: Number },
		unit: { type: String, default: 'meters' }
	},
	// Central feature (rink, stage, field, etc.)
	centralFeature: {
		type: {
			type: String,
			enum: ['none', 'stage', 'rink', 'field', 'court', 'custom']
		},
		name: { type: String }, // e.g., "Ice Rink", "Main Stage"
		shape: {
			type: String,
			enum: ['rectangle', 'circle', 'ellipse', 'polygon'],
			default: 'rectangle'
		},
		// Rectangle bounds
		x: { type: Number },
		y: { type: Number },
		width: { type: Number },
		height: { type: Number },
		// Circle/Ellipse
		centerX: { type: Number },
		centerY: { type: Number },
		radiusX: { type: Number },
		radiusY: { type: Number },
		// Polygon points
		points: [{ x: { type: Number }, y: { type: Number } }],
		color: { type: String, default: '#E3F2FD' },
		strokeColor: { type: String, default: '#1976D2' },
		// Image support for rink/field visualization
		imageUrl: { type: String }, // URL or base64 data URL for the central feature image
		imageWidth: { type: Number }, // Width to display the image (optional, uses shape dimensions if not set)
		imageHeight: { type: Number }, // Height to display the image (optional, uses shape dimensions if not set)
		imageOpacity: { type: Number, default: 1.0 }, // Opacity of the image overlay (0-1)
		// Direction indicator label (shown as arrow on canvas)
		directionLabel: { type: String, default: 'Kenttä' } // Label for direction arrow (e.g., "Kenttä", "Field", "Stage")
	},
	// Background SVG map for visual reference (optional)
	backgroundSvg: {
		svgContent: { type: String }, // Raw SVG XML content (sanitized)
		sourceUrl: { type: String }, // Original URL or filename for reference
		sourceType: {
			type: String,
			enum: ['url', 'upload'],
			default: 'url'
		},
		// Display settings
		opacity: {
			type: Number,
			default: 0.5,
			min: 0,
			max: 1
		},
		scale: {
			type: Number,
			default: 1.0,
			min: 0.1,
			max: 5
		},
		translateX: { type: Number, default: 0 }, // Horizontal offset in pixels
		translateY: { type: Number, default: 0 }, // Vertical offset in pixels
		rotation: { type: Number, default: 0 }, // Rotation in degrees (0-360)
		isVisible: { type: Boolean, default: true }, // Toggle visibility
		uploadedAt: { type: Date }, // Timestamp when SVG was added
		// Seat display configuration (for consistent rendering across CMS and customer app)
		displayConfig: {
			dotSize: { type: Number, default: 8 }, // Seat dot radius in pixels
			rowGap: { type: Number, default: 10 }, // Vertical spacing between rows
			seatGap: { type: Number, default: 12 } // Horizontal spacing between seats
		}
	},
	// Legacy stage support (for backward compatibility)
	stage: {
		x: { type: Number },
		y: { type: Number },
		width: { type: Number },
		height: { type: Number }
	},
	sections: [{
		id: { type: String, required: true },
		name: { type: String, required: true },

		// Section type
		type: {
			type: String,
			enum: ['seating', 'standing', 'box', 'lounge', 'bar', 'accessible', 'vip', 'premium', 'general', 'custom'],
			default: 'seating'
		},

		// Ticket sales availability
		isTicketed: {
			type: Boolean,
			default: true // Most sections are for ticket sales
		},
		// Optional: reason why section is not ticketed (e.g., 'entrance', 'exit', 'concession', 'restroom', 'staff_area')
		nonTicketedReason: { type: String },

		// Shape definition - supports both rectangle and polygon
		shape: {
			type: String,
			enum: ['rectangle', 'polygon'],
			default: 'rectangle'
		},

		// Rectangle bounds (legacy support)
		bounds: {
			x1: { type: Number },
			y1: { type: Number },
			x2: { type: Number },
			y2: { type: Number }
		},

		// Polygon points for irregular shapes
		polygon: [{ x: { type: Number }, y: { type: Number } }],

		// Visual properties
		color: { type: String },
		strokeColor: { type: String },
		opacity: { type: Number, default: 0.7 },

		// Capacity and configuration
		capacity: { type: Number }, // Expected capacity for this section
		rows: { type: Number }, // Number of rows (if applicable)
		seatsPerRow: { type: Number }, // Seats per row (if uniform - use rowConfig for variable rows)

		// Seating presentation style - how seats are arranged visually
		presentationStyle: {
			type: String,
			enum: ['flat', 'cone', 'left_fixed', 'right_fixed'],
			default: 'flat'
		},

		// Ground/field direction - which way the seats face (towards the field/stage)
		// Optional: null means no direction indicator will be shown
		groundDirection: {
			type: String,
			enum: ['up', 'down', 'left', 'right', null],
			default: null // Optional - no arrow shown by default
		},

		// Seat numbering direction - which direction seat numbers increase
		seatNumberingDirection: {
			type: String,
			enum: ['left-to-right', 'right-to-left'],
			default: 'left-to-right' // Default: seat 1 is on the left, numbers increase to the right
		},

		// Show row labels on the seat map
		showRowLabels: {
			type: Boolean,
			default: true // Default: show row labels
		},

		// Visual spacing and sizing configuration (optional, with defaults)
		spacingConfig: {
			topPadding: { type: Number, default: 40 }, // Top padding in pixels (default: 40px)
			seatSpacingMultiplier: { type: Number, default: 0.65 }, // Seat spacing multiplier (0.65 = 35% reduction, default: 0.65)
			rowSpacingMultiplier: { type: Number, default: 0.75 }, // Row spacing multiplier (0.75 = 25% reduction, default: 0.75)
			curveDepthMultiplier: { type: Number, default: 0.7 }, // Curve depth as percentage of row spacing (default: 70%)
			seatRadius: { type: Number, default: 7 }, // Seat dot radius in pixels (default: 7px)
			seatSpacingVisual: { type: Number, default: 1.0 }, // Visual spacing between seats (frontend multiplier, 1.0 = no scaling)
			rowSpacingVisual: { type: Number, default: 1.0 }, // Visual spacing between rows (frontend multiplier, 1.0 = no scaling)
			topMargin: { type: Number, default: 30 }, // Top margin in pixels for frontend rendering (default: 30px)
			rotationAngle: { type: Number, default: 0 }, // Seat rotation angle in degrees for angled sections (default: 0°)
			curveDirection: { type: String, default: 'frown' }, // Curve direction: 'frown' (edges up) or 'smile' (edges down)
			topMarginY: { type: Number }, // Top margin Y for row positioning
			bottomMarginY: { type: Number } // Bottom margin Y for row positioning
		},

		// Advanced row configuration - allows different seat counts per row
		rowConfig: [{
			rowNumber: { type: Number }, // Row number (1-based)
			rowLabel: { type: String }, // Optional custom row label (e.g., "A", "1", "Front")
			seatCount: { type: Number }, // Number of seats in this row
			startSeatNumber: { type: Number, default: 1 }, // Starting seat number for this row
			aisleLeft: { type: Number, default: 0 }, // Number of seats to skip on the left (aisle)
			aisleRight: { type: Number, default: 0 }, // Number of seats to skip on the right (aisle)
			offsetX: { type: Number, default: 0 }, // Horizontal offset for this row (for curved/angled rows)
			offsetY: { type: Number, default: 0 }, // Vertical offset adjustment for this row
			blockedSeats: [{ type: Number }] // Array of seat positions to hide/block (e.g., [5, 6, 7] to hide seats 5-7 in the grid)
		}],

		// Pricing and metadata
		priceTier: { type: String },
		basePrice: { type: Number }, // Base price for this section (in cents)

		// Accessibility and features
		accessible: { type: Boolean, default: false },
		features: [{ type: String }], // e.g., ['wheelchair', 'companion', 'elevator_access']

		// Additional metadata
		metadata: { type: mongoose.Schema.Types.Mixed },

		// Display order
		displayOrder: { type: Number, default: 0 },

		// Obstructions/Blocked Areas within this section (entrances, pillars, etc.)
		obstructions: [{
			id: { type: String, required: true },
			name: { type: String }, // e.g., "Entrance", "Pillar", "Aisle Block"
			type: { type: String, enum: ['entrance', 'pillar', 'aisle', 'obstruction', 'custom'], default: 'obstruction' },
			shape: { type: String, enum: ['rectangle', 'polygon'], default: 'rectangle' },
			// Rectangle bounds
			bounds: {
				x1: { type: Number },
				y1: { type: Number },
				x2: { type: Number },
				y2: { type: Number }
			},
			// Polygon points for irregular obstructions
			polygon: [{ x: { type: Number }, y: { type: Number } }],
			color: { type: String, default: '#CCCCCC' }, // Grey color for obstructions
			strokeColor: { type: String, default: '#999999' }
		}]
	}],
	aisles: [{
		x1: { type: Number },
		y1: { type: Number },
		x2: { type: Number },
		y2: { type: Number },
		width: { type: Number }
	}],
	layoutConfig: {
		seatSpacing: { type: Number, default: 0.5 },
		rowSpacing: { type: Number, default: 0.8 },
		sectionSpacing: { type: Number, default: 1.0 }
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now }
});
venueSchema.index({ merchant: 1 });
venueSchema.index({ externalVenueId: 1 });
venueSchema.index({ country: 1 }); // Index for country-based filtering
venueSchema.index({ city: 1, country: 1 }); // Compound index for city/country queries

// Manifest Schema (Core - Supports Micro-Level Pricing)
const manifestSchema = new mongoose.Schema({
	venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true },
	name: { type: String }, // Optional manifest name/version
	version: { type: Number, default: 1 }, // Version tracking
	updateHash: { type: String }, // Hash for change detection
	updateTime: { type: Number }, // Timestamp in milliseconds

	// Places/Seats with micro-level pricing
	places: [{
		placeId: { type: String, required: true, index: true }, // Unique identifier
		x: { type: Number }, // X coordinate (if available)
		y: { type: Number }, // Y coordinate (if available)
		row: { type: String }, // Row identifier
		seat: { type: String }, // Seat number
		section: { type: String, index: true }, // Section name
		zone: { type: String, index: true }, // Pricing zone

		// Micro-level pricing structure
		pricing: {
			basePrice: { type: Number, required: true }, // Base price in cents
			currency: { type: String, default: 'EUR' },

			// Dynamic pricing modifiers
			modifiers: [{
				type: {
					type: String,
					enum: ['percentage', 'fixed', 'multiplier', 'custom']
				},
				value: { type: Number }, // Modifier value
				reason: { type: String }, // e.g., 'premium_seat', 'vip', 'early_bird'
				validFrom: { type: Date }, // Time-based pricing start
				validUntil: { type: Date }, // Time-based pricing end
				conditions: { type: mongoose.Schema.Types.Mixed } // Custom conditions
			}],

			// Final calculated price (cached for performance)
			currentPrice: { type: Number }, // Current effective price
			priceUpdatedAt: { type: Date }, // When price was last calculated

			// Price history (for analytics)
			priceHistory: [{
				price: { type: Number },
				timestamp: { type: Date },
				reason: { type: String }
			}]
		},

		// Availability and status
		available: { type: Boolean, default: true },
		status: {
			type: String,
			enum: ['available', 'reserved', 'sold', 'blocked', 'unavailable'],
			default: 'available'
		},
		reservedUntil: { type: Date }, // Reservation expiry

		// Categories and tags for flexible grouping
		categories: [{ type: String }], // e.g., ['vip', 'premium', 'accessible']
		tags: [{ type: String }], // Flexible tagging system

		// Metadata for extensibility
		metadata: { type: mongoose.Schema.Types.Mixed }
	}],

	// Pricing strategies and rules
	pricingStrategies: [{
		name: { type: String },
		type: {
			type: String,
			enum: ['static', 'dynamic', 'time_based', 'demand_based', 'zone_based', 'custom']
		},
		rules: { type: mongoose.Schema.Types.Mixed }, // Flexible rule structure
		appliesTo: {
			type: { type: String, enum: ['all', 'section', 'zone', 'category', 'tags', 'custom'] },
			values: [{ type: String }] // Section names, zone IDs, category names, etc.
		},
		active: { type: Boolean, default: true },
		validFrom: { type: Date },
		validUntil: { type: Date }
	}],

	// Coordinate source and layout info
	coordinateSource: {
		type: String,
		enum: ['api', 'pattern_inference', 'manual', 'imported']
	},
	layoutAlgorithm: {
		type: String,
		enum: ['grid', 'curved', 'general', 'custom', 'manual']
	},

	// Encoded format fields (Ticketmaster format for seat-based events)
	eventId: { type: String, index: true }, // Link to event
	isLocked: { type: Boolean, default: false }, // Whether manifest is locked for an event
	encodedFormat: { type: Boolean, default: false }, // Ticketmaster format flag
	placeIds: [{ type: String }], // Compressed placeIds array (for availability + display)
	partitions: [{ type: Number }], // Price change boundaries (indices in placeIds array)
	pricingZones: [{
		start: { type: Number }, // Start index in placeIds array
		end: { type: Number }, // End index in placeIds array
		price: { type: Number }, // Price in cents
		currency: { type: String, default: 'EUR' },
		section: { type: String } // Section name
	}],
	availability: {
		sold: [{ type: String }] // Array of sold placeIds
	},
	// Section metadata for display (from venue)
	sections: [{
		id: { type: String },
		name: { type: String },
		color: { type: String },
		bounds: { type: mongoose.Schema.Types.Mixed }, // For section overlay
		polygon: [{ x: { type: Number }, y: { type: Number } }]
	}],
	backgroundSvg: { type: String }, // SVG for background (from venue)

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
manifestSchema.index({ venue: 1 });
manifestSchema.index({ 'places.placeId': 1 });
manifestSchema.index({ 'places.section': 1 });
manifestSchema.index({ 'places.zone': 1 });
manifestSchema.index({ 'places.status': 1 });
manifestSchema.index({ 'places.pricing.currentPrice': 1 });
manifestSchema.index({ updateHash: 1 });
manifestSchema.index({ eventId: 1 }); // For event-based manifest lookup
manifestSchema.index({ isLocked: 1, encodedFormat: 1 }); // For locked manifest queries

// Event Manifest Schema (Encoded Ticketmaster format for events)
// This is separate from the venue Manifest collection to avoid corrupting venue configuration
// Venue manifests stay in the Manifest collection and are never modified
const eventManifestSchema = new mongoose.Schema({
	eventId: { type: String, required: true, index: true }, // Internal MongoDB event ID (_id as string) for direct association with Event collection
	venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true }, // Reference to venue (not a copy)

	// Ticketmaster format fields only
	updateHash: { type: String, required: true }, // MD5 hash of sorted placeIds
	updateTime: { type: Number, required: true }, // Timestamp in milliseconds
	placeIds: [{ type: String, required: true }], // Array of place IDs
	partitions: [{ type: Number }], // Price change boundaries (indices in placeIds array)

	// Availability tracking (for sold seats)
	availability: {
		sold: [{ type: String }] // Array of sold placeIds
	},

	// Pricing zones (for internal price lookup - not part of Ticketmaster format)
	// This is needed to look up prices by placeId, but is not included in Ticketmaster-format output
	pricingZones: [{
		start: { type: Number }, // Start index in placeIds array
		end: { type: Number }, // End index in placeIds array
		price: { type: Number }, // Price in cents
		currency: { type: String, default: 'EUR' },
		section: { type: String } // Section name
	}],

	// Pricing configuration reference (compact, referenced by encoded placeIds)
	pricingConfig: {
		currency: { type: String, default: 'EUR' },
		orderFee: { type: Number, default: 0 }, // Per-order fee (same for all seats)
		orderTax: { type: Number, default: 0 }, // Order fee tax percentage
		tiers: [{
			id: { type: String, required: true }, // Tier identifier (encoded in placeId)
			basePrice: { type: Number, required: true },
			tax: { type: Number, default: 0 }, // VAT/Tax percentage
			serviceFee: { type: Number, default: 0 },
			serviceTax: { type: Number, default: 0 } // Service tax percentage
		}]
	},

	// Metadata
	s3Key: { type: String }, // S3 key for the enriched manifest (for reference)
	pricingConfigurationId: { type: String }, // Reference to pricing configuration

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
eventManifestSchema.index({ eventId: 1 });
eventManifestSchema.index({ venue: 1 });
eventManifestSchema.index({ updateHash: 1 });

// 3. Apply the audit plugin to all schemas BEFORE creating any models
const schemas = [
	inboxMessageSchema,
	outboxMessageSchema,
	merchantSchema,
	orderTicketSchema,paymentSchema,settingSchema,ticketSchema,messageSchema,photoSchema,photoTypeSchema,
	notificationSchema,notificationTypeSchema,tokenSchema,eventSchema,timeBasedPriceSchema,eventTypeSchema,
	socialMediaSchema,contactSchema,cryptoSchema,roleSchema, userSchema, ticketAnalyticsSchema, externalTicketSalesSchema,
	venueSchema, manifestSchema, eventManifestSchema
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
export const Venue = mongoose.model('Venue', venueSchema)
export const Manifest = mongoose.model('Manifest', manifestSchema)
export const EventManifest = mongoose.model('EventManifest', eventManifestSchema)
export const Role = mongoose.model('Role', roleSchema)
export const User = mongoose.model('User', userSchema)
export const Merchant = mongoose.model('Merchant', merchantSchema);
export const TicketAnalytics = mongoose.model('TicketAnalytics', ticketAnalyticsSchema);
export const ExternalTicketSales = mongoose.model('ExternalTicketSales', externalTicketSalesSchema);