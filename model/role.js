(function () {

	var model = require('./mongoModel');

	var Role = (function () {

		function Role(roleType) {
			this.roleType = roleType;
		}

		Role.prototype.saveToDB = async function () {
			var role = new model.Role({ roleType: this.roleType });
			await role.save();
		}
		return Role;
	})();

	const createRole = async function (roleType) { 
		var role = new Role(roleType);
		return await role.saveToDB();
	}

	const getAllRole = async function () {
		return await model.Role.find().catch(err=>{return {error:err.stack}})
	}

	const getRoleByRoleType = async (roleType) => {
		return await model.Role.findOne({ 'roleType': roleType }).catch(err=>{return {error:err.stack}})
	}

	const findRoleById = async function (id) {
		return await model.Role.findById(id).catch(err=>{return {error:err.stack}})
	}

	const deleteRole = async (roleType) => {
		return await model.Role.deleteOne({ 'roleType': roleType }).catch(err=>{return {error:err.stack}})
	}
	let root = typeof exports !== 'undefined' && exports !== null ? exports : window;
	root.Role = Role;
	root.createRole = createRole;
	root.getAllRole = getAllRole;
	root.findRoleById = findRoleById;
	root.getRoleByRoleType = getRoleByRoleType
	root.deleteRole = deleteRole
}).call(this);
