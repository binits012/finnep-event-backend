'use strict'
const jwtToken = require('../util/jwtToken')
require('dotenv').config() 
const user = require('../controllers/user.controller')
const contact = require('../controllers/contact.controller')

const login = async (req, res, next) => {
    await user.login(req,res,next)
}
const createAdminUser = async (req, res, next) => {
    await user.createAdminUser(req,res,next)
}
const getAdminUsers = async (req, res, next) => {
    await user.getAdminUsers(req, res, next)
}
const createStaffUser = async (req, res, next) => {
    await user.createStaffUser(req,res,next)
}

const getStaffUsers = async (req, res, next) => {
    await user.getStaffUsers(req,res,next)
}

const changePassword = async (req, res, next) => {
    await user.changePassword(req,res,next)
}

const getUserById = async (req, res, next) => {
    await user.getUserById(req,res,next)
}

const updateUserById = async(req, res, next) =>{
    await user.updateUserById(req,res,next)
}
const deleteUserById = async (req, res, next) => {
    await user.deleteUserById(req, res, next)
}

const getContact = async(req,res, next) => {
    await contact.getContact(req,res,next)
}

const createContact = async(req, res, next) =>{
    await contact.createContact(req,res,next)
}

const updateContact = async(req, res, next) =>{
    await contact.updateContact(req, res, next) 
}


const logout = async (req, res, next) => {
	
    const token = req.query.token
    if(token !== null){
        await jwtToken.invalidateJWT(token, async (err, data) => {
            res.send(200).json({reply:"ok"})
        })
    }
	
};



module.exports = {
    login,
    createAdminUser,
    getAdminUsers,
    createStaffUser, 
    getStaffUsers,
    changePassword,
    getUserById,
    updateUserById,
    deleteUserById,
    getContact,
    createContact,
    updateContact,
    logout
}
