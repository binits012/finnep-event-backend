import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class PhotoType {
    constructor(name) {
        this.name = name
    }
    async saveToDB() {
        try{
            const photoType = new model.PhotoType({ name: this.name })
            return await photoType.save()
        }catch(err){
            error('error creating phototype %s', err.stack)
            throw err
        }
        
    }
}

export const createPhotoType = async (name) =>{ 
    let photoType = new PhotoType(name)
    return await photoType.saveToDB()
}

export const getPhotoTypes = async() =>{ 
    return await model.PhotoType.find().exec().catch(err=>{  return err})
}

export const getPhotoTypeByName = async(name) =>{
    return await model.PhotoType.find({name:name}).exec().catch(err=>{return err})
}

export const getPhotoTypeById = async(id) => { 
    return await model.PhotoType.find({_id:id}).catch(err=>{return err})
} 
