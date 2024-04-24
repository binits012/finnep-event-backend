import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class Photo {
	constructor(photoLink, publish, position, photoType) {
		this.photoLink = photoLink;
		this.publish = publish;
		this.position = position;
		this.photoType = photoType;
	}
	async saveToDB() {
		try{
			const photo = new model.Photo({ photoLink: this.photoLink, publish: this.publish, position: this.position, photoType: this.photoType });
			return await photo.save();
		}catch(err){
			error('error creating photo %s',err.stack)
			throw err
		}
		
	}
}

export const uploadPhoto = async function (photoLink, publish, position, photoType) {
	var photo = new Photo(photoLink, publish, position, photoType);
	return await photo.saveToDB();
}

export const listPhoto = async function () {

	return await model.Photo.find({}).populate('photoType').sort({ position: 1 }).catch(err=>{return {error:err.stack}})
}

export const updatePhotoById = async function (id, position, publish, photoType) {
	return await model.Photo.findByIdAndUpdate(id, { $set: { position: position, publish: publish, photoType:photoType } },
		 { new: true }).catch(err=>{return {error:err.stack}})
}

export const getPhotoById = async (id) => {
	return await model.Photo.findOne({ '_id': id }).catch(err=>{return {error:err.stack}})
}

export const deletePhotoById = async (id) => {
	return await model.Photo.findByIdAndRemove(id).catch(err=>{return {error:err.stack}})
}

export const getGalleryPhoto = async() =>{
	return await model.Photo.find().populate({path:'photoType', match:{name:"Gallery"}}).exec()
}  
