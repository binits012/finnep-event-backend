'use strict'
const jwtToken = require('../util/jwtToken')
const logger = require('../model/logger')
const User = require('../model/users')
const appText = require('../applicationTexts.js')
require('dotenv').config() 
const consts = require('../const')
const user = require('../controllers/user.controller')
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

const logout = async (req, res, next) => {
	
    const token = req.query.token
    if(token !== null){
        await jwtToken.invalidateJWT(token, async (err, data) => {
            res.redirect('/login');
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
    logout
}
