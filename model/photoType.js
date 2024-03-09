(function () {
    let model = require('./mongoModel')
    const logger = require('./logger');
    let root, createPhotoType, getPhotoTypes,getPhotoTypeByName
    let PhotoType = (function () {
		function PhotoType(name ) {
			this.name = name 
		}

		PhotoType.prototype.saveToDB = async function () {
			let photoType = new model.PhotoType({ name: this.name  })
			return await photoType.save()
		}

		return PhotoType

	})()

    createPhotoType = async (name) =>{ 
        let photoType = new PhotoType(name)
		return await photoType.saveToDB()
    }

    getPhotoTypes = async() =>{ 
        return await model.PhotoType.find().exec().catch(err=>{  return err})
    }

    getPhotoTypeByName = async(name) =>{
        return await model.PhotoType.find({name:name}).exec().catch(err=>{return err})
    }
    root = typeof exports !== 'undefined' && exports !== null ? exports : window
    root.createPhotoType = createPhotoType
    root.getPhotoTypes = getPhotoTypes
    root.getPhotoTypeByName = getPhotoTypeByName
}).call()
