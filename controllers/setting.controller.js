import * as jwtToken from '../util/jwtToken.js'
import * as consts from'../const.js'
import * as appText from '../applicationTexts.js'
import {error} from '../model/logger.js'
import * as Setting from '../model/setting.js'
import { validatePublicSiteConfig, otherInfoToPlain } from '../util/publicSiteConfig.js'
import {
    validateBusinessLandingConfig,
    canMutateBusinessLanding,
    prepareIncomingOtherInfoForCreate,
	mergeBusinessLandingBeforeValidate,
} from '../util/businessLanding.js'
import { refreshCorsOriginsFromDb } from '../util/corsAllowlist.js'
import { normalizeIso3166Alpha2 } from '../util/iso3166Alpha2.js'

export const createSetting = async (req,res,next) =>{
    const token = req.headers.authorization
    const aboutSection = req.body.aboutSection
    const contactInfo = req.body.contactInfo
    const socialMedia = req.body.socialMedia
    const otherInfo = req.body.otherInfo
    const isPlatformDefault = req.body.isPlatformDefault === true || req.body.isPlatformDefault === 'true'
    const rawCountry = req.body.marketCountryCode
    const wantsCountry = rawCountry != null && String(rawCountry).trim() !== ''

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const preparedCreateOi = prepareIncomingOtherInfoForCreate(userRoleFromToken, otherInfo)
            if (!preparedCreateOi.ok) {
                return res.status(preparedCreateOi.status).json(preparedCreateOi.body)
            }
            const safeOtherInfoForCreate = preparedCreateOi.otherInfo
            const prevSetting = await Setting.getSetting().catch(err=>{ 
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, setting creation failed', error: err.stack
                })
            })  
            const list = Array.isArray(prevSetting) && !(prevSetting instanceof Error) ? prevSetting : []

            if (wantsCountry && isPlatformDefault) {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Cannot set both marketCountryCode and isPlatformDefault on one row'
                })
            }

            if (wantsCountry) {
                const n = normalizeIso3166Alpha2(String(rawCountry))
                if (!n) {
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Invalid marketCountryCode (ISO 3166-1 alpha-2 required)'
                    })
                }
                const dup = await Setting.findSettingByMarketCountryCode(n)
                if (dup) {
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: `A setting row already exists for country ${n}`
                    })
                }
                await Setting.createSetting(aboutSection, contactInfo, socialMedia, safeOtherInfoForCreate, {
                    isPlatformDefault: false,
                    marketCountryCode: n
                }).then((data) => {
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data })
                }).catch((err) => {
                    error('error', err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, setting creation failed', error: err.stack
                    })
                })
                return
            }

            if (isPlatformDefault) {
                const dc = await Setting.countPlatformDefaults()
                if (dc > 0) {
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'A platform default setting already exists; update it or add a country row instead.'
                    })
                }
                await Setting.createSetting(aboutSection, contactInfo, socialMedia, safeOtherInfoForCreate, {
                    isPlatformDefault: true,
                    marketCountryCode: null
                }).then((data) => {
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data })
                }).catch((err) => {
                    error('error', err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, setting creation failed', error: err.stack
                    })
                })
                return
            }

            // Legacy: first-ever row becomes platform default
            if (list.length === 0) {
                await Setting.createSetting(aboutSection, contactInfo, socialMedia, safeOtherInfoForCreate, {
                    isPlatformDefault: true,
                    marketCountryCode: null
                }).then((data) => {
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data })
                }).catch((err) => {
                    error('error', err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, setting creation failed', error: err.stack
                    })
                })
                return
            }

            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Use marketCountryCode or isPlatformDefault to add another settings row',
                error: appText.SETTING_NOT_ALLOWED
            })
        }
    })
}

export const getSetting = async(req,res,next)=>{
    const token = req.headers.authorization 
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            
            await Setting.getSetting().then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get setting failed', error: err.stack
                })
            }) 
            
        }
    })
}

export const getSettingById = async(req,res,next)=>{
    const token = req.headers.authorization 
    const id = req.params.id
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            
            await Setting.getSettingById(id).then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get setting by id failed', error: err.stack
                })
            }) 
            
        }
    })
}

export const updateSettingById = async(req,res,next)=>{
    const token = req.headers.authorization 
    const id = req.params.id
    const aboutSection = req.body.aboutSection
    const contactInfo = req.body.contactInfo
    const socialMedia = req.body.socialMedia
    const otherInfo = req.body.otherInfo
    const isPlatformDefault = req.body.isPlatformDefault
    const marketCountryCode = req.body.marketCountryCode
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            const prevSetting = await Setting.getSettingById(id)
            if(prevSetting.length >0){
                const prevDoc = prevSetting[0]
                const updateObj = {
                    aboutSection: aboutSection,
                    contactInfo: contactInfo,
                    socialMedia: socialMedia,
                }
                if (isPlatformDefault === true || isPlatformDefault === 'true') {
                    const otherDefaults = await Setting.countPlatformDefaultsOtherThan(id)
                    if (otherDefaults > 0) {
                        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                            message: 'Another row is already the platform default; unset it first.'
                        })
                    }
                    updateObj.isPlatformDefault = true
                    updateObj.marketCountryCode = null
                } else if (isPlatformDefault === false || isPlatformDefault === 'false') {
                    updateObj.isPlatformDefault = false
                }
                if (marketCountryCode !== undefined) {
                    if (marketCountryCode === null || marketCountryCode === '') {
                        updateObj.marketCountryCode = null
                    } else {
                        const n = normalizeIso3166Alpha2(String(marketCountryCode))
                        if (!n) {
                            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                                message: 'Invalid marketCountryCode (ISO 3166-1 alpha-2 required)'
                            })
                        }
                        const dup = await Setting.findSettingByMarketCountryCode(n)
                        if (dup && String(dup._id) !== String(prevDoc._id)) {
                            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                                message: `Another row already uses country ${n}`
                            })
                        }
                        updateObj.marketCountryCode = n
                        updateObj.isPlatformDefault = false
                    }
                }
                // Only touch otherInfo when the client sends it — avoids wiping terms/locales/etc.
                // When sent, merge with existing so partial CMS payloads cannot erase nested keys.
                if (otherInfo !== undefined && otherInfo !== null) {
                    if (Array.isArray(otherInfo)) {
                        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                            message: 'otherInfo must be a plain object',
                        })
                    }
                    const prevPlain = otherInfoToPlain(prevDoc.otherInfo)
                    const incoming =
                        otherInfo instanceof Map
                            ? Object.fromEntries(otherInfo.entries())
                            : typeof otherInfo === 'object'
                              ? { ...otherInfo }
                              : {}
                    const merged = { ...prevPlain, ...incoming }
                    const businessLandingChanged = (() => {
                        if (!Object.prototype.hasOwnProperty.call(incoming, 'businessLanding')) {
                            return false
                        }
                        try {
                            return (
                                JSON.stringify(prevPlain.businessLanding ?? null) !==
                                JSON.stringify(incoming.businessLanding ?? null)
                            )
                        } catch {
                            return true
                        }
                    })()
                    if (businessLandingChanged) {
                        if (!canMutateBusinessLanding(userRoleFromToken)) {
                            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                                message: 'Only admin or superAdmin may change businessLanding',
                                error: appText.INSUFFICENT_ROLE,
                            })
                        }
                        const mergedBl = mergeBusinessLandingBeforeValidate(
                            prevPlain.businessLanding,
                            merged.businessLanding,
                        )
                        const vBl = validateBusinessLandingConfig(mergedBl)
                        if (!vBl.ok) {
                            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                                message: 'Invalid businessLanding',
                                errors: vBl.errors,
                            })
                        }
                        merged.businessLanding = vBl.normalized
                    }
                    if (merged.publicSiteConfig != null) {
                        const v = validatePublicSiteConfig(merged.publicSiteConfig)
                        if (!v.ok) {
                            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                                message: 'Invalid publicSiteConfig',
                                errors: v.errors
                            })
                        }
                        merged.publicSiteConfig = v.normalized
                    }
                    updateObj.otherInfo = merged
                }
                await Setting.updateSettingById(id, updateObj).then(async (data) => {
                    if (updateObj.otherInfo !== undefined) {
                        await refreshCorsOriginsFromDb()
                    }
                    return res.status(consts.HTTP_STATUS_OK).json({ data: data })
                }).catch(err=>{
                    error('error',err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, update setting by id failed', error: err.stack
                    })
                }) 
            }else{
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, update setting by id failed', error: err.stack
                })
            }
             
            
        }
    })
}
 