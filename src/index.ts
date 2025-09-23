import { PrivateKey, BeeRequestOptions, SOCReader, Reference, RedundancyLevel } from '@ethersphere/bee-js'
import { Binary, Strings } from 'cafe-utility'
import { makeChunk } from '@fairdatasociety/bmt-js'

const POSTAGE_BATCH = 'b961413232c96eedae48947a71c99e454e51c4b5bf93a77c59f958af1229a932'
const UPLOAD_URL = 'http://localhost:1633'
const DOWNLOAD_URL = 'http://localhost:11633'

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
    socData: Uint8Array
    constructionTime: number
}

async function createSocUploader() {
    const privateKey = new PrivateKey(Strings.randomHex(64))
    const address = privateKey.publicKey().address()
    const identifierGenerator = create32ByteGenerator()
    // const feedWriter = bee.makeFeedWriter(NULL_TOPIC, privateKey)
    // const manifest = await bee.createFeedManifest(postageBatch, NULL_TOPIC, address, { redundancyLevel: 1 }) // could we set rlevel in manifest to not specify it on download?

    const hookFn = async (redundancyLevel: number): Promise<UploadResult> => {
        const id = identifierGenerator.next()
        const identifier = Binary.uint8ArrayToHex(id)
        const payload = new TextEncoder().encode(`This is write number ${identifier}`)
        const soc = constructSOCChunk(privateKey, id, payload)
        
        const startTime = performance.now()
        await uploadSoc(address.toHex(), identifier, soc.socData, redundancyLevel)
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
    
    const socData = Binary.concatBytes(identifier, signature, cacSpan, cacData)

    const endTime = performance.now()
    
    return {
        owner: signer.publicKey().address().toHex(),
        identifier: Binary.uint8ArrayToHex(identifier),
        socData,
        constructionTime: endTime - startTime
    }
}

async function uploadSoc(
    owner: string,
    identifier: string,
    socData: Uint8Array,
    redundancyLevel = 0,
): Promise<void> {
    const beeUrl = UPLOAD_URL // uploader
    const postageBatch = POSTAGE_BATCH
    const url = `${beeUrl}/soc/${owner}/${identifier}`
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'swarm-postage-batch-id': postageBatch,
            'swarm-redundancy-level': redundancyLevel.toString(),
        },
        body: socData
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

async function downloadSoc(
    ownerAddress: string,
    identifier: string,
    redundancyLevel = 0,
): Promise<DownloadResult> {
    const beeUrl = DOWNLOAD_URL
    const startTime = performance.now()
    const response = await fetch(`${beeUrl}/soc/${ownerAddress}/${identifier}`, {
        headers: {
            'swarm-redundancy-level': redundancyLevel.toString(),
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

main()

async function main() {
    const redundancyLevel = 0
    const uploader = await createSocUploader()
    const uploadResult = await uploader.hookFn(redundancyLevel)
    console.log(`Redundancy level: ${redundancyLevel}`)
    console.log(`Construction time: ${uploadResult.constructionTime}`)
    console.log(`Upload time: ${uploadResult.uploadTime}`)
    const downloadResult = await downloadSoc(uploader.owner, uploadResult.identifier, redundancyLevel)
    console.log(`Data: ${uploadResult.payload}`)
    console.log(`Downloaded data: ${downloadResult.data}`)
    console.log(`Data matches: ${Binary.equals(uploadResult.payload, downloadResult.data)}`)
    console.log(`Download time: ${downloadResult.downloadTime}`)
}