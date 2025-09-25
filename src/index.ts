import { PrivateKey } from '@ethersphere/bee-js'
import { Binary, Strings } from 'cafe-utility'
import { makeChunk } from '@fairdatasociety/bmt-js'

const POSTAGE_BATCH = '48ddab68b7595f766de6aa233b6ff92dd382fd078952d70487d311218ea555d6'
const UPLOAD_URL = 'http://localhost:11633'
const DOWNLOAD_URL = 'http://localhost:1633'

/// UPLOAD

interface UploadResult {
    payload: Uint8Array
    identifier: string
    constructionTime: number
    uploadTime: number
}

interface SOCConstructionResult {
    owner: string
    identifier: string
    signature: Uint8Array
    socPayload: Uint8Array
    constructionTime: number
}

async function createFeedUploader(topicBytes: Uint8Array) {
    const privateKey = new PrivateKey(Strings.randomHex(64))
    const ownerAddress = privateKey.publicKey().address().toHex()
    let id = 0

    const hookFn = async (redundancyLevel: number): Promise<UploadResult> => {
        id++
        const identifier = makeFeedIdentifier(topicBytes, id)
        const payload = new TextEncoder().encode(`This is write number ${id}`)
        const soc = constructSOCChunk(privateKey, identifier, payload)
        console.log("topic is at upload", Binary.uint8ArrayToHex(topicBytes))
        
        const startTime = performance.now()
        await uploadSoc(ownerAddress, Binary.uint8ArrayToHex(identifier), soc.signature, soc.socPayload, redundancyLevel)
        const endTime = performance.now()
        
        return {
            payload,
            identifier: Binary.uint8ArrayToHex(identifier),
            constructionTime: soc.constructionTime,
            uploadTime: endTime - startTime
        }
    }

    return {
        hookFn,
        owner: ownerAddress,
    }
}

async function createSocUploader() {
    const privateKey = new PrivateKey(Strings.randomHex(64))
    const address = privateKey.publicKey().address()
    const identifierGenerator = create32ByteGenerator()

    const hookFn = async (redundancyLevel: number): Promise<UploadResult> => {
        const id = identifierGenerator.next()
        const identifier = Binary.uint8ArrayToHex(id)
        const payload = new TextEncoder().encode(`This is write number ${identifier}`)
        const soc = constructSOCChunk(privateKey, id, payload)

        const startTime = performance.now()
        await uploadSoc(address.toHex(), identifier, soc.signature, soc.socPayload, redundancyLevel)
        const endTime = performance.now()
        
        return {
            payload,
            identifier: identifier,
            constructionTime: soc.constructionTime,
            uploadTime: endTime - startTime
        }
    }

    return {
        hookFn,
        owner: address.toHex(),
    }
}

function constructSOCChunk(
    signer: PrivateKey,
    identifier: Uint8Array,
    payload: Uint8Array,
): SOCConstructionResult {
    const startTime = performance.now()
    
    // Create cac data
    const chunk = makeChunk(payload)
    const cacSpan = chunk.span()
    const cacData = chunk.data()
    const cacAddr = chunk.address()
    
    // Sign the payload
    const sig = signer.sign(Binary.concatBytes(identifier, cacAddr))
    const signature = sig.toUint8Array()
    const socPayload = Binary.concatBytes(cacSpan, cacData)

    const endTime = performance.now()
    
    return {
        owner: signer.publicKey().address().toHex(),
        identifier: Binary.uint8ArrayToHex(identifier),
        signature: signature,
        socPayload,
        constructionTime: endTime - startTime
    }
}

async function uploadSoc(
    owner: string,
    identifier: string,
    signature: Uint8Array,
    socPayload: Uint8Array<ArrayBufferLike>,
    redundancyLevel = 0,
): Promise<void> {
    const beeUrl = UPLOAD_URL // uploader
    const postageBatch = POSTAGE_BATCH
    const signatureHex = Binary.uint8ArrayToHex(signature)
    const url = `${beeUrl}/soc/${owner}/${identifier}?sig=${signatureHex}`
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'swarm-postage-batch-id': postageBatch,
            'swarm-redundancy-level': redundancyLevel.toString(),
        },
        body: new Uint8Array(socPayload),
    })
    
    if (!response.ok) {
        throw new Error(`SOC upload failed: ${response.status} ${response.statusText}`)
    }
}

/// DOWNLOAD

interface DownloadResult {
    data: Uint8Array
    downloadTime: number
}

async function downloadFeed(
    ownerAddress: string,
    topicBytes: Uint8Array,
    redundancyLevel = 0,
): Promise<DownloadResult> {
    const beeUrl = DOWNLOAD_URL
    const topic = Binary.uint8ArrayToHex(topicBytes)
    const startTime = performance.now()
    console.log("topic is at download", topic)
    const response = await fetch(`${beeUrl}/feeds/${ownerAddress}/${topic}`, {
        // headers: {
        //     'swarm-redundancy-level': redundancyLevel.toString(),
        // },
    })
    const endTime = performance.now()
    
    if (!response.ok) {
        throw new Error(`Feed download failed: ${response.status} ${response.statusText}`)
    }
    
    const data = new Uint8Array(await response.arrayBuffer())
    
    return {
        data,
        downloadTime: endTime - startTime
    }
}

async function downloadSoc(
    ownerAddress: string,
    identifier: string,
    redundancyLevel = 0,
): Promise<DownloadResult> {
    const beeUrl = DOWNLOAD_URL
    const startTime = performance.now()
    const response = await fetch(`${beeUrl}/soc/${ownerAddress}/${identifier}`, {
        headers: {
            // 'swarm-redundancy-level': redundancyLevel.toString(),
        },
    })
    const endTime = performance.now()
    
    if (!response.ok) {
        throw new Error(`SOC download failed: ${response.status} ${response.statusText}`)
    }
    
    const data = new Uint8Array(await response.arrayBuffer())
    
    return {
        data,
        downloadTime: endTime - startTime
    }
}

/// UTILITY FUNCTIONS

/**
 * Creates a 32-byte identifier generator that starts with zeros and increments like a counter
 * @returns Object with next() method that returns a new 32-byte Uint8Array identifier
 */
function create32ByteGenerator() {
    let counter = 0n // Use BigInt for large numbers
    
    return {
        next: (): Uint8Array => {
            const identifier = new Uint8Array(32)
            
            // Convert counter to bytes (little-endian)
            let temp = counter
            for (let i = 0; i < 8 && temp > 0n; i++) {
                identifier[i] = Number(temp & 0xFFn)
                temp = temp >> 8n
            }
            
            counter++
            return identifier
        }
    }
}

function makeFeedIdentifier(topicBytes: Uint8Array, index: number): Uint8Array {
    const indexBytes = Binary.numberToUint64(BigInt(index), 'BE')

    return Binary.keccak256(Binary.concatBytes(topicBytes, indexBytes))
}

/// MEASUREMENTS

async function measureSoc() {
    const attempts = 10
    
    for (let redundancyLevel = 0; redundancyLevel <= 4; redundancyLevel++) {
        console.log(`\n=== Testing Redundancy Level ${redundancyLevel} ===`)
        
        const uploader = await createSocUploader()
        const uploadTimes: number[] = []
        const constructionTimes: number[] = []
        const downloadTimes: number[] = []
        let successfulUploads = 0
        
        for (let i = 0; i < attempts; i++) {
            try {
                //console.log(`Attempt ${i + 1}/${attempts}...`)
                const uploadResult = await uploader.hookFn(redundancyLevel)
                
                // Verify download works
                const downloadResult = await downloadSoc(uploader.owner, uploadResult.identifier, redundancyLevel)
                const dataMatches = Binary.equals(uploadResult.payload, downloadResult.data)
                
                if (dataMatches) {
                    uploadTimes.push(uploadResult.uploadTime)
                    constructionTimes.push(uploadResult.constructionTime)
                    downloadTimes.push(downloadResult.downloadTime)
                    successfulUploads++
                } else {
                    console.log(`  ❌ Data mismatch on attempt ${i + 1}`)
                }
            } catch (error) {
                console.log(`  ❌ Failed attempt ${i + 1}: ${error}`)
            }
        }
        
        if (successfulUploads > 0) {
            // Calculate statistics
            const uploadStats = calculateStats(uploadTimes)
            const constructionStats = calculateStats(constructionTimes)
            const downloadStats = calculateStats(downloadTimes)
            
            console.log(`\nResults for Redundancy Level ${redundancyLevel}:`)
            console.log(`Successful uploads: ${successfulUploads}/${attempts}`)
            console.log(`\nUpload Times (ms):"`)
            console.log(`  Average: ${uploadStats.average.toFixed(2)}`)
            console.log(`  Min: ${uploadStats.min.toFixed(2)}`)
            console.log(`  Max: ${uploadStats.max.toFixed(2)}`)
            console.log(`  Std Dev: ${uploadStats.stdDev.toFixed(2)}`)
            
            console.log(`\nConstruction Times (ms):"`)
            console.log(`  Average: ${constructionStats.average.toFixed(2)}`)
            console.log(`  Min: ${constructionStats.min.toFixed(2)}`)
            console.log(`  Max: ${constructionStats.max.toFixed(2)}`)
            console.log(`  Std Dev: ${constructionStats.stdDev.toFixed(2)}`)
            
            console.log(`\nDownload Times (ms):"`)
            console.log(`  Average: ${downloadStats.average.toFixed(2)}`)
            console.log(`  Min: ${downloadStats.min.toFixed(2)}`)
            console.log(`  Max: ${downloadStats.max.toFixed(2)}`)
            console.log(`  Std Dev: ${downloadStats.stdDev.toFixed(2)}`)
        } else {
            console.log(`\n❌ No successful uploads for redundancy level ${redundancyLevel}`)
        }
    }
}

async function measureFeed() {
    const feeds = 1
    const updates = 2
    
    for (let redundancyLevel = 0; redundancyLevel <= 1; redundancyLevel++) {
        console.log(`\n=== Testing Feed Redundancy Level ${redundancyLevel} ===`)
        
        const uploadTimes: number[] = []
        const constructionTimes: number[] = []
        const downloadTimes: number[] = []
        const identifierGenerator = create32ByteGenerator()
        let successfulTests = 0
        
        for (let feedIndex = 0; feedIndex < feeds; feedIndex++) {
            try {
                const topicBytes = identifierGenerator.next()
                const feedUploader = await createFeedUploader(topicBytes)
                
                let totalUploadTime = 0
                let totalConstructionTime = 0
                
                // Perform multiple updates
                for (let update = 0; update < updates; update++) {
                    const uploadResult = await feedUploader.hookFn(redundancyLevel)
                    totalUploadTime += uploadResult.uploadTime
                    totalConstructionTime += uploadResult.constructionTime
                }

                // sleep
                await new Promise(resolve => setTimeout(resolve, 3000))
                
                // Try to download the feed
                const downloadResult = await downloadFeed(feedUploader.owner, topicBytes, redundancyLevel)
                
                // Record successful test
                uploadTimes.push(totalUploadTime)
                constructionTimes.push(totalConstructionTime)
                downloadTimes.push(downloadResult.downloadTime)
                successfulTests++
                
            } catch (error) {
                console.log(`  ❌ Failed attempt ${feedIndex + 1}: ${error}`)
            }
        }
        
        if (successfulTests > 0) {
            // Calculate statistics
            const uploadStats = calculateStats(uploadTimes)
            const constructionStats = calculateStats(constructionTimes)
            const downloadStats = calculateStats(downloadTimes)
            
            console.log(`\nFeed Results for Redundancy Level ${redundancyLevel}:`)
            console.log(`Successful tests: ${successfulTests}/${feeds} (${updates} updates each)`)
            console.log(`\nTotal Upload Times (ms):`)
            console.log(`  Average: ${uploadStats.average.toFixed(2)}`)
            console.log(`  Min: ${uploadStats.min.toFixed(2)}`)
            console.log(`  Max: ${uploadStats.max.toFixed(2)}`)
            console.log(`  Std Dev: ${uploadStats.stdDev.toFixed(2)}`)
            
            console.log(`\nTotal Construction Times (ms):`)
            console.log(`  Average: ${constructionStats.average.toFixed(2)}`)
            console.log(`  Min: ${constructionStats.min.toFixed(2)}`)
            console.log(`  Max: ${constructionStats.max.toFixed(2)}`)
            console.log(`  Std Dev: ${constructionStats.stdDev.toFixed(2)}`)
            
            console.log(`\nFeed Download Times (ms):`)
            console.log(`  Average: ${downloadStats.average.toFixed(2)}`)
            console.log(`  Min: ${downloadStats.min.toFixed(2)}`)
            console.log(`  Max: ${downloadStats.max.toFixed(2)}`)
            console.log(`  Std Dev: ${downloadStats.stdDev.toFixed(2)}`)
        } else {
            console.log(`\n❌ No successful feed tests for redundancy level ${redundancyLevel}`)
        }
    }
}

main()

async function main() {
    // await measureSoc()
    await measureFeed()
}

function calculateStats(values: number[]) {
    if (values.length === 0) {
        return { average: 0, min: 0, max: 0, stdDev: 0 }
    }
    
    const average = values.reduce((sum, val) => sum + val, 0) / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)
    
    // Calculate standard deviation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / values.length
    const stdDev = Math.sqrt(variance)
    
    return { average, min, max, stdDev }
}