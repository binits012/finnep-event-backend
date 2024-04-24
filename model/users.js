import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'
import * as consts from '../const.js'


export class User {
	constructor(name, pwd, role, active, notificationAllowed) {
		this.name = name;
		this.pwd = pwd;
		this.role = role;
		this.active = active;
		this.notificationAllowed = notificationAllowed;
	}

	async saveToDB() {
		try{
			const user = new model.User({
				name: this.name,
				pwd: this.pwd,
				role: this.role,
				active: this.active,
				notificationAllowed: this.notificationAllowed
			});

			return await user.save();
		}catch(err){
			error(err.stack)
			throw err
		}
	}
}

export const createUser = async function (name, pwd, role, active,notificationAllowed) {
	var user = new User(name, pwd, role, active,notificationAllowed);

	return await user.saveToDB();

}

export const  loginCheck = async function (name, pass) {
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

export const getAllUsers = async function () {
	return await model.User.find().select('-pwd').populate('role').sort({ createdAt: -1 }).catch(err=>{return {error:err.stack}}) 
}

export const getUserByName = async (username) => {

	return await model.User.findOne({ 'name': username }).populate('role').catch(err=>{return {error:err.stack}})
}
export const deleteUserByname = async (username) => {
	const user = await model.User.findOne({ 'name': username })
	return await model.User.deleteOne({ '_id': user._id }).catch(err=>{return {error:err.stack}})
}

export const deleteUserById = async(id) =>{
	return await model.User.deleteOne({ '_id':  id }).catch(err=>{return {error:err.stack}})
}
//listing users
export const getUsersByRole = async (roleType) => {
	if (consts.ROLE_SUPER_ADMIN === roleType || consts.ROLE_ADMIN === roleType) {
		return await model.User.find().populate('role')
			.then((data) => data.filter(el => el.role.roleType === roleType)).catch(err=>{return {error:err.stack}})
	} else {
		return await model.User.find().select('-pwd').populate('role')
			.then((data) => data.filter(el => el.role.roleType === roleType)).catch(err=>{return {error:err.stack}})
	}
}

export const updateUserPassword = async (filter, update) => {
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
			error('error',err)
			return err;
		})
}

export const getUserById = async (id) => {
	return await model.User.findById({ '_id': id }).populate('role').select('-pwd').exec().catch(err=>{return {error:err.stack}})
}

export const updateUser = async (id, user) => {
	return await model.User.findByIdAndUpdate(id, { $set: user }, { new: true }).select('-pwd').exec().catch(err=>{return {error:err.stack}})
}

export const getUserWithContact = async () =>{ 
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
		error('error',err)
		return err;
	  })
	return await model.User.populate(contact, {path:'role'})
	   
}


