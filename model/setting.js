
import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'

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
    return await setting.saveToDB()
}

export const getSetting = async()=>{
    return await model.Setting.find().exec().catch(err=>{
        error('error getting settings %s', err.stack)
        return err
    })
}
export const getSettingById = async (id) =>{
    return await model.Setting.find({_id:id}).exec().catch(err=>{
        error('error getting settings by id %s', err.stack)
        return err
    })
}

export const updateSettingById = async(id, obj) =>{
    return await model.Setting.findOneAndUpdate({_id:id}, {
        $set:  obj,
    }, { new: true }).catch(err=>{
        error('error updating settings by id %s', err.stack)
        return err
    })
}