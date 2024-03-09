(function () {
	var model = require('./mongoModel')
	const consts = require('../const') 
	const logger = require('./logger')
	var User = (function () {
		function User(name, pwd, role, active, notificationAllowed) {
			this.name = name
			this.pwd = pwd
			this.role = role
			this.active = active
			this.notificationAllowed = notificationAllowed
		}

		User.prototype.saveToDB = function () {
			const user = new model.User({
				name: this.name,
				pwd: this.pwd,
				role: this.role,
				active: this.active,
				notificationAllowed: this.notificationAllowed
			});

			return user.save()
		}
		return User

	})()

	const createUser = async function (name, pwd, role, active,notificationAllowed) {
		var user = new User(name, pwd, role, active,notificationAllowed);

		return await user.saveToDB();

	}

	const loginCheck = async function (name, pass) {
		return await model.User.findOne({ name: name }).populate('role')
			.then(data => {
				if (data) {
					if (data.active === false) return null
					return data.comparePassword(pass).then(proceed => {
						if (proceed) return data
						return null
					})
				} else {
					return null
				}
			}).catch(err=>{return {error:err.stack}})
	}

	const getAllUsers = async function () {
		return await model.User.find().select('-pwd').populate('role').sort({ createdAt: -1 }).catch(err=>{return {error:err.stack}}) 
	}

	const getUserByName = async (username) => {

		return await model.User.findOne({ 'name': username }).populate('role').catch(err=>{return {error:err.stack}})
	}
	const deleteUserByname = async (username) => {
		const user = await model.User.findOne({ 'name': username })
		return await model.User.deleteOne({ '_id': user._id }).catch(err=>{return {error:err.stack}})
	}

	const deleteUserById = async(id) =>{
		return await model.User.deleteOne({ '_id':  id }).catch(err=>{return {error:err.stack}})
	}
	//listing users
	const getUsersByRole = async (roleType) => {
		if (consts.ROLE_SUPER_ADMIN === roleType || consts.ROLE_ADMIN === roleType) {
			return await model.User.find().populate('role')
				.then((data) => data.filter(el => el.role.roleType === roleType)).catch(err=>{return {error:err.stack}})
		} else {
			return await model.User.find().select('-pwd').populate('role')
				.then((data) => data.filter(el => el.role.roleType === roleType)).catch(err=>{return {error:err.stack}})
		}
	}

	const updateUserPassword = async (filter, update) => {
		return await model.User.findOne(filter)
			.then(data => {
				if (data) {
					//check the given password is hashed or not 
					if (data.pwd === update.pwd) {
						return model.User.findOneAndUpdate(filter, { pwd: data }, {
							new: true
						}).catch(err=>{return err})
					} else {
						//plain password hash it first
						return data.hashPassword(update.pwd)
							.then(hash => {
								return model.User.findOneAndUpdate(filter, { pwd: hash }, {
									new: true
								})
							})
							.catch(err=>{return {error:err.stack}})
					}

				}
			}).catch(err => {
				logger.log('error',err)
				return err;
			})
	}

	const getUserById = async (id) => {
		return await model.User.findById({ '_id': id }).populate('role').select('-pwd').exec().catch(err=>{return {error:err.stack}})
	}

	const updateUser = async (id, user) => {
		return await model.User.findByIdAndUpdate(id, { $set: user }, { new: true }).select('-pwd').exec().catch(err=>{return {error:err.stack}})
	}

	const getUserWithContact = async () =>{ 
		const contact= await model.User.aggregate([
			{$match:{'notificationAllowed':true}},
			{
				
				$lookup: {
				from: "contacts",
				localField:"_id",
				foreignField:"user",
				as:"contacts"
				}
			}
		]).catch((err) => {
			logger.log('error',err)
			return err;
		  })
		return await model.User.populate(contact, {path:'role'})
		   
	}

	let root = typeof exports !== "undefined" && exports !== null ? exports : window;
	root.User = User;
	root.createUser = createUser
	root.loginCheck = loginCheck
	root.getAllUsers = getAllUsers
	root.deleteUserByname = deleteUserByname
	root.getUserByName = getUserByName
	root.getUsersByRole = getUsersByRole
	root.updateUserPassword = updateUserPassword
	root.getUserById = getUserById
	root.updateUser = updateUser
	root.deleteUserById = deleteUserById
	root.getUserWithContact = getUserWithContact


}).call(this);
