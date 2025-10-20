import * as redis from 'redis';
import dotenv from 'dotenv'
dotenv.config() 
class RedisSingleton {
    constructor() {
        if (!RedisSingleton.instance) {
            console.log('Creating new Redis client instance');
            console.log(process.env.REDIS_HOST);
            console.log(process.env.REDIS_PORT);
            console.log(process.env.REDIS_PWD ? 'Password is set' : 'No password set');
            RedisSingleton.instance = redis.createClient({
                socket: {  // Updated for Redis v4
                    host: process.env.REDIS_HOST || '127.0.0.1',  // Fallback to localhost if not set
                    port: process.env.REDIS_PORT || 6379
                },
                password: process.env.REDIS_PWD,
                // no_ready_check is deprecated in v4; remove if not needed
            });

            RedisSingleton.instance.connect().catch(console.error);

            RedisSingleton.instance.on('error', function (error) {
                console.error('Redis Error:', error.stack);
            });
        }
        return RedisSingleton.instance;
    }
}

// Export the instance
const redisClient = new RedisSingleton();
export default redisClient;
