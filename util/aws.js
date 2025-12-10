import dotenv from 'dotenv'
dotenv.config()
import { S3Client,PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {error, info} from '../model/logger.js'
const s3Client = new S3Client({
    bucket:process.env.BUCKET_NAME,
    region: process.env.BUCKET_REGION,
    credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_CLIENT,
    secretAccessKey: process.env.BUCKET_ACCESS_KEY,
    }
})

export const uploadToS3Bucket = async (fileType, fileContent, pathToS3) =>{

    await s3Client.send(
        new PutObjectCommand({
            Bucket:process.env.BUCKET_NAME,
            Key:pathToS3,
            ContentType: fileType,
            Body:fileContent
        })
    ).catch(err=>{
        error('error',err.stack)
    })
    info( "sending %s photo to bucket end at %s",pathToS3 ,new Date())
  }

export const streamBasedParallelUpload = async(fileType,key, streamObj) =>{

    const parallelUploads3 = new Upload({
        client: s3Client,
        params: {
            Bucket: process.env.BUCKET_NAME,
            Key: key,
            ContentType: fileType,
            Body: streamObj
        },
        queueSize:4,
        partSize:1024*1024*5, //5mb
        leavePartsOnError: false

    })

    parallelUploads3.on("httpUploadProgress", (progress) => {
        console.log(progress)
        info( "sending %s photo to bucket end at %s",key ,new Date())
    })

    await parallelUploads3.done()

}

/**
 * Download pricing JSON from S3
 * @param {string} s3Key - S3 key for pricing file
 * @returns {Promise<Object>} Parsed JSON pricing data
 */
export const downloadPricingFromS3 = async (s3Key) => {
    try {

        const command = new GetObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: s3Key
        });

        const response = await s3Client.send(command);

        // Read the stream
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        const jsonString = buffer.toString('utf-8');
        const pricingData = JSON.parse(jsonString);

        info(`Pricing downloaded from S3: ${s3Key}`);
        return pricingData;
    } catch (err) {
        error(`Error downloading pricing from S3 (${s3Key}):`, err.stack);
        throw new Error(`Failed to download pricing from S3: ${err.message}`);
    }
}

/**
 * Upload manifest to S3 with fixed key (overwrites existing)
 * @param {Object} manifest - Manifest JSON object
 * @param {String} venueId - MongoDB venue ID
 * @returns {Promise<String>} S3 key
 */
export const uploadManifestToS3 = async (manifest, venueId) => {
    try {
        // Serialize manifest to JSON string
        const manifestJson = JSON.stringify(manifest)
        const manifestSizeBytes = Buffer.byteLength(manifestJson, 'utf8')
        const manifestSizeMB = manifestSizeBytes / (1024 * 1024)

        // Validate size < 5MB
        if (manifestSizeMB > 5) {
            throw new Error(`Manifest size ${manifestSizeMB.toFixed(2)}MB exceeds 5MB limit`)
        }

        // Fixed key per venue (overwrites existing)
        const s3Key = `manifests/${venueId}/manifest.json`

        // Upload to S3
        await s3Client.send(
            new PutObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: s3Key,
                ContentType: 'application/json',
                Body: manifestJson
            })
        )

        info(`Manifest uploaded to S3: ${s3Key} (${manifestSizeMB.toFixed(2)}MB)`)
        return s3Key
    } catch (err) {
        error('Error uploading manifest to S3:', err.stack)
        throw err
    }
}
/*
module.exports = {
    uploadToS3Bucket,
    streamBasedParallelUpload
}
*/