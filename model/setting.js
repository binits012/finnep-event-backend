
import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'
import redisClient from './redisConnect.js'
import * as commonUtil from '../util/common.js'
import { SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL } from '../const.js'

export class Setting {
        constructor(aboutSection, contactInfo, socialMedia, otherInfo = null) {
            this.aboutSection = aboutSection
            this.contactInfo = contactInfo
            this.socialMedia = socialMedia
            this.otherInfo = otherInfo
        }
    async saveToDB() {
        try{
            const setting = new model.Setting({
                aboutSection: this.aboutSection,
                contactInfo: this.contactInfo,
                socialMedia: this.socialMedia,
                otherInfo: this.otherInfo
            })
            return await setting.save()
        }catch(err){
            error('error creating setting %s', err.stack)
            throw err
        }

    }
}
export const createSetting = async (aboutSection, contactInfo, socialMedia, otherInfo = null) =>{
    const setting = new Setting(aboutSection, contactInfo, socialMedia, otherInfo)
    const savedSetting = await setting.saveToDB()

    // Clear the cache after creating new settings
    if (savedSetting) {
        await commonUtil.removeCacheByKey(redisClient, SETTINGS_CACHE_KEY)
    }

    return savedSetting
}

export const getSetting = async()=>{
    try {
        // Try to get from cache first
        const cached = await commonUtil.getCacheByKey(redisClient, SETTINGS_CACHE_KEY)
        if (cached && !(cached instanceof Error) && cached !== null) {
            return cached
        }

        // If not in cache, get from database
        const settings = await model.Setting.find().exec()

        // Cache the result
        if (settings) {
            await commonUtil.setCacheByKey(redisClient, SETTINGS_CACHE_KEY, settings)
            redisClient.expire(SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL)
        }

        return settings
    } catch(err) {
        error('error getting settings %s', err.stack)
        return err
    }
}
export const getSettingById = async (id) =>{
    return await model.Setting.find({_id:id}).exec().catch(err=>{
        error('error getting settings by id %s', err.stack)
        return err
    })
}

export const updateSettingById = async(id, obj) =>{
    try {
        const updatedSetting = await model.Setting.findOneAndUpdate({_id:id}, {
            $set:  obj,
        }, { new: true })

        // Invalidate cache after update
        if (updatedSetting) {
            await commonUtil.removeCacheByKey(redisClient, SETTINGS_CACHE_KEY)
        }

        return updatedSetting
    } catch(err) {
        error('error updating settings by id %s', err.stack)
        return err
    }
}