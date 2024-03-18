
(function(){

    const model = require('./mongoModel')
    let root = typeof exports !== "undefined" && exports !== null ? exports : window;
    const SocialMedia = (function(){
        function SocialMedia(name){
            this.name = name
        }

        SocialMedia.prototype.saveToDB = function(){
            const socialMedia = new model.SocialMedia({
                name: this.name,
            })
            return socialMedia.save()
        }

        return SocialMedia
    })()

    const createSocialMedia = async (name) =>{
        const socialMedia = new SocialMedia(name)
        return await socialMedia.saveToDB()
    }

    const getAllSocialMedia = async () => {
        return await model.SocialMedia.find().exec().catch(err =>{return err})
    }
    root.SocialMedia = SocialMedia
    root.createSocialMedia = createSocialMedia
    root.getAllSocialMedia = getAllSocialMedia


}).call(this)