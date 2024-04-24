import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class Role {
	constructor(roleType) {
		this.roleType = roleType;
	}
	async saveToDB() {
		try{
			const role = new model.Role({ roleType: this.roleType });
			await await role.save();
		}catch(err){
			error('error creating role %s', err.stack)
			throw err
		}
		
	}
}
export const createRole = async function (roleType) { 
	var role = new Role(roleType);
	return await role.saveToDB();
}

export const getAllRole = async function () {
	return await model.Role.find().catch(err=>{return {error:err.stack}})
}

export const getRoleByRoleType = async (roleType) => {
	return await model.Role.findOne({ 'roleType': roleType }).catch(err=>{return {error:err.stack}})
}

export const findRoleById = async function (id) {
	return await model.Role.findById(id).catch(err=>{return {error:err.stack}})
}

export const deleteRole = async (roleType) => {
	return await model.Role.deleteOne({ 'roleType': roleType }).catch(err=>{return {error:err.stack}})
}