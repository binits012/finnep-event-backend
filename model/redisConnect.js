import * as redis from 'redis';
import dotenv from 'dotenv'
dotenv.config() 
class RedisSingleton {
    constructor() {
        if (!RedisSingleton.instance) {
            RedisSingleton.instance = redis.createClient({
                port: process.env.REDIS_PORT,
                host: process.env.REDIS_HOST,
                no_ready_check: true,
                password: process.env.REDIS_PWD
            });

            RedisSingleton.instance.connect().catch(console.error);

            RedisSingleton.instance.on('error', function (error) {
                console.error('Redis Error:', error);
            });
        }
        return RedisSingleton.instance;
    }
}

// Export the instance
const redisClient = new RedisSingleton();
export default redisClient;
