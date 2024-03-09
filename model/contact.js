
(function () {

	const model = require('../model/mongoModel')
	const hash = require('../util/createHash')
	const logger = require('./logger')

	let root, createContact, updateContactById, getContactById, deleteContactById
	let Contact = (function () {

		function Contact(streetName, user, crypto) {
			this.streetName = streetName
			this.user = user
			this.crypto = crypto
		}

		Contact.prototype.saveToDB = async function () {
			var contact = new model.Contact({
				streetName: this.streetName,
				user: this.user,
				crypto: this.crypto
			})
			return await contact.save()
		};
		return Contact;
	})();

	createContact = async function (streetName, phone, email, user) {
		const emailHash = await hash.createHashData(email, 'email')
		const phoneHash = await hash.createHashData(phone, 'phone')
		const tempCrypto = new Array(emailHash, phoneHash)
		const contact = new Contact(streetName, user, tempCrypto)
		try {
			return await contact.saveToDB()
		} catch (err) {
			await hash.deleteHashById(emailHash.id).catch(err=>{return {error:err.stack}})
			await hash.deleteHashById(phoneHash).catch(err=>{return {error:err.stack}})
			throw err
		}

	}

	getContactById = async (userId) => {
		const contact = await model.Contact.findOne({ 'user': userId }).populate('user').exec().catch(err=>{return {error:err.stack}})

		if (contact === null || contact.error) {
			return null
		}
		const data1 = await hash.readHash(contact.crypto[0]).catch(err => {
			logger.log('error',err)
			return err
		})
		const data2 = await hash.readHash(contact.crypto[1]).catch(err => {
			logger.log('error',err)
			return err
		})
		const data = {
			_id: contact.id,
			user: {
				_id: contact.user.id,
				name: contact.user.name,
				role: contact.user.role,
				active: contact.user.active
			},
			contact: [data1, data2],
			streetName: contact.streetName
		}
		return data
	}

	updateContactById = async (id, streetName, emailId, email, phoneId, phone) => {
		const emailUpdate = await hash.updateHash(emailId, email)
		const phoneUpdate = await hash.updateHash(phoneId, phone)
		const tempCrypto = new Array(emailUpdate, phoneUpdate)
		return await model.Contact.findByIdAndUpdate(id, {
			$set: {
				'streetName': streetName,
				'crypto': tempCrypto
			}
		}, { new: true }).catch(err=>{return {error:err.stack}})
	}

	deleteContactById = async (id, emailId, phoneId) => {
		await hash.deleteHashById(emailId)
		await hash.deleteHashById(phoneId)
		return await model.Contact.deleteOne({ '_id': id }).catch(err=>{return {error:err.stack}})
	}

	root = typeof exports !== 'undefined' && exports !== null ? exports : window
	root.Contact = Contact
	root.createContact = createContact
	root.updateContactById = updateContactById
	root.getContactById = getContactById
	root.deleteContactById = deleteContactById
	
}).call(this);