import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class SocialMedia{
    constructor(name){
        this.name = name
    }

    async saveToDB(){
        try{
            const socialMedia = new model.SocialMedia({
                name: this.name,
            })
            return await socialMedia.save()
        }catch(err){
            error('error creating social media %s',err.stack)
            throw err
        }
    }
}

export const createSocialMedia = async (name) =>{
    const socialMedia = new SocialMedia(name)
    return await socialMedia.saveToDB()
}

export const getAllSocialMedia = async () => {
    return await model.SocialMedia.find().exec().catch(err =>{return err})
}
 