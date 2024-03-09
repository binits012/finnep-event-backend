(function () {

    const model = require('./mongoModel')
    let JWTToken = (function () {

        function JWTToken(token, userId) {
            this.token = token;
            this.userId = userId;
        }

        JWTToken.prototype.saveToDB = function () {
            const JWTToken = new model.JWTToken({
                token: this.token,
                userId: this.userId 
            });

            return JWTToken.save()
        }
        return JWTToken;
    })()

    const createToken = async function (token, userId) { 
        const tokenByUserId = await getTokenByUserId(userId)  
        if(tokenByUserId === undefined || tokenByUserId === null){
            //let's add the token to db
            const jwtToken = new JWTToken(token, userId)
            return await jwtToken.saveToDB()
        }else{
            // let's update the existing entry 
           return await updateTokenByUserId(tokenByUserId.userId, token, true)
        }
    }
    const getTokenByUserId = async (userId) =>{ 
        return await model.JWTToken.findOne({userId:userId}).exec().catch(err=>{return err})
    }
    const updateTokenByUserId = async (userId, token, isValid) =>{
        return await model.JWTToken.findOneAndUpdate({userId:userId}, {
			$set: {
				'token': token, 'isValid': isValid   
			}
		}, { new: true }).catch(err=>{return {error:err.stack}})
    }
    const removeTokenByUserId = async (userId) =>{
        return await model.JWTToken.deleteOne({userId:userId})
    }
    let root = typeof exports !== "undefined" && exports !== null ? exports : window;
    root.JWTToken = JWTToken
    root.createToken = createToken
    root.getTokenByUserId = getTokenByUserId
    root.updateTokenByUserId = updateTokenByUserId
    root.removeTokenByUserId = removeTokenByUserId

}).call(this)
