
(function(){
    const model = require('./mongoModel')
    const logger = require('./logger')
    const Setting = (function(){
        function Setting(aboutSection, contactInfo, socialMedia){
            this.aboutSection = aboutSection
            this.contactInfo = contactInfo
            this.socialMedia = socialMedia
        }
        Setting.prototype.saveToDB = function(){
            const setting = new model.Setting({
                aboutSection: this.aboutSection,
                contactInfo:this.contactInfo,
                socialMedia:this.socialMedia
            })
            return setting.save()
        }
        return Setting
    })()

    const createSetting = async (aboutSection, contactInfo, socialMedia) =>{
        const setting = new Setting(aboutSection, contactInfo, socialMedia)
        return await setting.saveToDB()
    }

    const getSetting = async()=>{
        return await model.Setting.find().exec().catch(err=>{
            logger.log('error', err.stack)
            return err
        })
    } 
    const getSettingById = async (id) =>{
        return await model.Setting.find({_id:id}).exec().catch(err=>{
            logger.log('error', err.stack)
            return err
        })
    }

    const updateSettingById = async(id, obj) =>{
        return await model.Setting.findOneAndUpdate({_id:id}, {
			$set:  obj,
		}, { new: true }).catch(err=>{
            logger.log('error', err.stack)
            return err
        })
    }
    let root = typeof exports !== "undefined" && exports !== null ? exports : window
    root.Setting = Setting
    root.getSetting = getSetting
    root.createSetting = createSetting
    root.getSettingById = getSettingById
    root.updateSettingById = updateSettingById


}).call(this)