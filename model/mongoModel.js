(function () {
    const mongoose = require('mongoose')
	const Schema = mongoose.Schema;
	const bcrypt = require('bcrypt')
	require('dotenv').config()

    let root = typeof exports !== "undefined" && exports !== null ? exports : window

    //user role is defined here
	const roleSchema = new Schema({
		roleType: { type: String, unique: true },
		createdAt: { type: Date, default: Date.now }
	});

	const Role = mongoose.model('Role', roleSchema)
	root.Role = Role


	const userSchema = new Schema({
		name: { type: String, required: true, unique: true, immutable: true, trim: true },
		pwd: { type: String, required: true },
		role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
		active: { type: Boolean, default: true },
		notificationAllowed:{ type: Boolean, default: true },
		createdAt: { type: Date, default: Date.now }
	});


	userSchema.pre('save', function (next) {
		let user = this;
		bcrypt.genSalt(Number(process.env.SALT_WORK_FACTOR), function (err, salt) {
			if (err) {
				return next(err);
			} else {
				bcrypt.hash(user.pwd, salt, function (err, hash) {
					if (err) return next(err);
					user.pwd = hash;
					next();
				});
			}
		});
	});

	userSchema.methods.hashPassword = async function (userPassword) {
		const hashPassword = await bcrypt.genSalt(Number(process.env.SALT_WORK_FACTOR)).then(salt => {
			if (salt) {
				return bcrypt.hash(userPassword, salt).then(hash => {
					return hash
				})
			}
		}).catch(err => { return err })
		return hashPassword

	}
	userSchema.methods.comparePassword = async function (pwd) {
		return await bcrypt.compare(pwd, this.pwd);
	}

	const User = mongoose.model('User', userSchema)
	root.User = User

    //encryption
	const CryptoSchema = new mongoose.Schema({
		createdAt: { type: Date, default: Date.now },
		iv: { type: String, required: true },
		encryptedData: { type: String, required: true },
		type: { type: String, required: true }
	})

	const Crypto = mongoose.model('Crypto', CryptoSchema)
	root.Crypto = Crypto
    
	// contact schema
	const contactSchema = new Schema({
		user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		crypto: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Crypto' }],
		streetName: { type: String, required: true },
		createdAt: { type: Date, default: Date.now }
	});
	const Contact = mongoose.model('Contact', contactSchema);
	root.Contact = Contact

    /**************** Event Type schema ******************** */
	const eventTypeSchema = new mongoose.Schema({

		eventType: { type: String, required: true, unique: true },
		position: { type: Number, required: true },
		lang:{type:String, default:'en'},
		createdAt: { type: Date, default: Date.now }
	})

    const EventType = mongoose.model('EventType', eventTypeSchema)
	root.EventType = EventType

    /********************** Events ************************/
	const eventSchema = new mongoose.Schema({
		eventTitle: { type: String, required: true },
		eventDescription: { type: String, required: true, unique: true },
		eventTime: { type: Number, required: true }, 
		eventDate: { type: Date, required: true },
		eventPrice: { type: mongoose.Types.Decimal128, required: true },
		lang:{type:String, default:'en'},
		position:{type:Number},
		createdAt: { type: Date, default: Date.now }
	})

	const Event = mongoose.model('Event', eventSchema)
	root.Event = Event
    
    //token
	const TokenSchema = new mongoose.Schema({
		token:{ type: String, required: true },
		userId:{type: String, required: true},
		isValid:{ type: Boolean, default: true },
		createdAt: { type: Date, default: Date.now }
	})
	const JWTToken = mongoose.model('JWTToken', TokenSchema)
	root.JWTToken = JWTToken

    //Notification for customer eg. sudden changes in the schedule
	var notificationSchema = new mongoose.Schema({
		notification: { type: String, required: true },
		startDate: { type: Date },
		endDate: { type: Date },
		publish: { type: Boolean, default: true },
		lang: { type:String, default:'en'},
		notificationType: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationType', required:true },
		createdAt: { type: Date, default: Date.now }
		
	})

	const Notification = mongoose.model('Notification', notificationSchema);
	root.Notification = Notification
    
	//notification Type
	const NotificationTypeSchema = new mongoose.Schema({
		name: {type:String, unique:true, required:true},
		publish:{ type: Boolean, default: true },
		createdAt: { type: Date, default: Date.now }
	}) 
	const NotificationType = mongoose.model('NotificationType', NotificationTypeSchema)
	root.NotificationType = NotificationType

    /* use of photo */
	const photoTypeSchema = new Schema({
		name: { type: String, unique:true, required: true },
		publish:{ type: Boolean, default: true },
		createdAt: { type: Date, default: Date.now }
	})
	const PhotoType = mongoose.model('PhotoType', photoTypeSchema);
	root.PhotoType = PhotoType;

	const photoSchema = new mongoose.Schema({
		createdAt: { type: Date, default: Date.now },
		photoLink: String,
		position: Number,
		publish:{ type:Boolean, default:true}, 
		photoType:[{type: mongoose.Schema.Types.ObjectId, ref: 'PhotoType', required:true}]
	})

	const Photo = mongoose.model('Photo', photoSchema)
	root.Photo = Photo
}).call(this)