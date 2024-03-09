(function () {
	let model = require('../model/mongoModel')

	let root, photo, uploadPhoto, listPhoto, updatePhotoById, getPhotoById, deletePhotoById

	let Photo = (function () {
		function Photo(photoLink, publish, position, photoType) {
			this.photoLink = photoLink
			this.publish = publish
			this.position = position
			this.photoType = photoType
		}

		Photo.prototype.saveToDB = async function () {
			let photo = new model.Photo({ photoLink: this.photoLink, publish: this.publish, position: this.position, photoType:this.photoType });

			return await photo.save();
		};

		return Photo;

	})();


	uploadPhoto = async function (photoLink, publish, position, photoType) {
		var photo = new Photo(photoLink, publish, position, photoType);
		return await photo.saveToDB();
	}

	listPhoto = async function () {

		return await model.Photo.find({}).populate('photoType').sort({ position: 1 }).catch(err=>{return {error:err.stack}})
	}

	updatePhotoById = async function (id, position, publish, photoType) {
		return await model.Photo.findByIdAndUpdate(id, { $set: { position: position, publish: publish, photoType:photoType } },
			 { new: true }).catch(err=>{return {error:err.stack}})
	}

	getPhotoById = async (id) => {
		return await model.Photo.findOne({ '_id': id }).catch(err=>{return {error:err.stack}})
	}

	deletePhotoById = async (id) => {
		return await model.Photo.findByIdAndRemove(id).catch(err=>{return {error:err.stack}})
	}
	root = typeof exports !== 'undefined' && exports !== null ? exports : window
	root.Photo = Photo
	root.listPhoto = listPhoto
	root.uploadPhoto = uploadPhoto
	root.updatePhotoById = updatePhotoById
	root.getPhotoById = getPhotoById
	root.deletePhotoById = deletePhotoById

}).call(this);
