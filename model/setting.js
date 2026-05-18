
import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'
import redisClient from './redisConnect.js'
import * as commonUtil from '../util/common.js'
import { SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL } from '../const.js'

export class Setting {
        constructor(aboutSection, contactInfo, socialMedia, otherInfo = null, meta = {}) {
            this.aboutSection = aboutSection
            this.contactInfo = contactInfo
            this.socialMedia = socialMedia
            this.otherInfo = otherInfo
            this.isPlatformDefault = !!meta.isPlatformDefault
            this.marketCountryCode = meta.marketCountryCode || null
        }
    async saveToDB() {
        try{
            const setting = new model.Setting({
                aboutSection: this.aboutSection,
                contactInfo: this.contactInfo,
                socialMedia: this.socialMedia,
                otherInfo: this.otherInfo,
                isPlatformDefault: this.isPlatformDefault,
                marketCountryCode: this.marketCountryCode
            })
            return await setting.save()
        }catch(err){
            error('error creating setting %s', err.stack)
            throw err
        }

    }
}

/** Ensure one default row after introducing isPlatformDefault (legacy DBs). */
export async function migrateLegacyPlatformSettings() {
    try {
        const defaultCount = await model.Setting.countDocuments({ isPlatformDefault: true })
        if (defaultCount > 0) return
        const first = await model.Setting.findOne().sort({ createdAt: 1 })
        if (!first) return
        await model.Setting.updateOne(
            { _id: first._id },
            { $set: { isPlatformDefault: true, marketCountryCode: null } }
        )
        await commonUtil.removeCacheByKey(redisClient, SETTINGS_CACHE_KEY)
    } catch (err) {
        error('migrateLegacyPlatformSettings %s', err?.stack || err)
    }
}

export const createSetting = async (aboutSection, contactInfo, socialMedia, otherInfo = null, meta = {}) =>{
    const setting = new Setting(aboutSection, contactInfo, socialMedia, otherInfo, meta)
    const savedSetting = await setting.saveToDB()

    // Clear the cache after creating new settings
    if (savedSetting) {
        await commonUtil.removeCacheByKey(redisClient, SETTINGS_CACHE_KEY)
    }

    return savedSetting
}

export const getSetting = async()=>{
    try {
        await migrateLegacyPlatformSettings()
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

export async function countPlatformDefaults() {
    return model.Setting.countDocuments({ isPlatformDefault: true })
}

/** Count rows marked default excluding one id (for promote-to-default validation). */
export async function countPlatformDefaultsOtherThan(excludeId) {
    return model.Setting.countDocuments({ isPlatformDefault: true, _id: { $ne: excludeId } })
}

export async function findSettingByMarketCountryCode(code) {
    if (!code) return null
    return model.Setting.findOne({ marketCountryCode: String(code).toUpperCase() }).exec()
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