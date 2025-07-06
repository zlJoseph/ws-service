import axios, { AxiosRequestConfig } from "axios";
import { MediaConnInfo, MediaDecryptionKeyInfo, MediaType, WAMediaUpload, WAMediaUploadFunction } from "../types/Message";
import { SocketConfig } from "../types/Socket";
import { createReadStream, createWriteStream, promises as fs, WriteStream } from "fs";
import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP } from "../Defaults";
import { Boom } from "@hapi/boom";
import { Readable } from "stream";
import * as Crypto from 'crypto'
import { generateMessageIDV2 } from "./generics";
import { join } from 'path'
import { once } from 'events'
import { tmpdir } from 'os'
import { hkdf } from './crypto'
import { exec } from 'child_process'
import type JimpNamespace from 'jimp'
import { Logger } from "src/application/ports/output";

export const toBuffer = async (stream: Readable) => {
	const chunks: Buffer[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}

	stream.destroy()
	return Buffer.concat(chunks)
}

const getImageProcessingLibrary = async () => {
	const [_jimp, sharp] = await Promise.all([
		(async () => {
			const jimp = await import('jimp').catch(() => {})
			return jimp
		})(),
		(async () => {
			const sharp = await import('sharp').catch(() => {})
			return sharp
		})()
	])

	if (sharp) {
		return { sharp }
	}

	const jimp = (_jimp as typeof JimpNamespace)
	if (jimp) {
		return { jimp }
	}

	throw new Boom('No image processing library available')
}

export const extractImageThumb = async (bufferOrFilePath: Readable | Buffer | string, width = 32) => {
	if (bufferOrFilePath instanceof Readable) {
		bufferOrFilePath = await toBuffer(bufferOrFilePath)
	}

	const lib = await getImageProcessingLibrary()
	if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
		const img = lib.sharp.default(bufferOrFilePath)
		const dimensions = await img.metadata()

		const buffer = await img.resize(width).jpeg({ quality: 50 }).toBuffer()
		return {
			buffer,
			original: {
				width: dimensions.width,
				height: dimensions.height
			}
		}
	} else if ('jimp' in lib && typeof lib.jimp?.Jimp.read === 'function') {
		const { read } = lib.jimp.Jimp
		const { jpeg: MIME_JPEG } = lib.jimp.JimpMime

		const jimp = await read(bufferOrFilePath as string)
		const dimensions = {
			width: jimp.width,
			height: jimp.height
		}
		const buffer = await jimp.resize({w: width, h: width, mode: lib.jimp.ResizeStrategy.BILINEAR}).getBuffer(MIME_JPEG)
		return {
			buffer,
			original: dimensions
		}
	} else {
		throw new Boom('No image processing library available')
	}
}

export const getHttpStream = async (url: string | URL, options: AxiosRequestConfig & { isStream?: true } = {}) => {
	const fetched = await axios.get(url.toString(), { ...options, responseType: 'stream' })
	return fetched.data as Readable
}

export const encodeBase64EncodedStringForUpload = (b64: string) =>
	encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/\=+$/, ''))

export const getWAUploadToServer = (
	{ customUploadHosts, fetchAgent, logger, options }: SocketConfig,
	refreshMediaConn: (force: boolean) => Promise<MediaConnInfo>
): WAMediaUploadFunction => {
	return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {
		// send a query JSON to obtain the url & auth token to upload our media
		let uploadInfo = await refreshMediaConn(false)

		let urls: { mediaUrl: string; directPath: string } | undefined
		const hosts = [...customUploadHosts, ...uploadInfo.hosts]

		fileEncSha256B64 = encodeBase64EncodedStringForUpload(fileEncSha256B64)

		for (const { hostname } of hosts) {
			//logger.debug(`uploading to "${hostname}"`)

			const auth = encodeURIComponent(uploadInfo.auth) // the auth token
			const url = `https://${hostname}${MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`
			
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let result: any
			try {
				const body = await axios.post(url, createReadStream(filePath), {
					...options,
					maxRedirects: 0,
					headers: {
						...(options.headers || {}),
						'Content-Type': 'application/octet-stream',
						Origin: DEFAULT_ORIGIN
					},
					httpsAgent: fetchAgent,
					timeout: timeoutMs,
					responseType: 'json',
					maxBodyLength: Infinity,
					maxContentLength: Infinity
				})
				result = body.data

				if (result?.url || result?.directPath) {
					urls = {
						mediaUrl: result.url,
						directPath: result.direct_path
					}
					break
				} else {
					uploadInfo = await refreshMediaConn(true)
					throw new Error(`upload failed, reason: ${JSON.stringify(result)}`)
				}
			} catch (error) {
				if (axios.isAxiosError(error)) {
					result = error.response?.data
				}

				const isLast = hostname === hosts[uploadInfo.hosts.length - 1]?.hostname
				/*logger.warn(
					{ trace: error.stack, uploadResult: result },
					`Error in uploading to ${hostname} ${isLast ? '' : ', retrying...'}`
				)*/
			}
		}

		if (!urls) {
			throw new Boom('Media upload failed on all hosts', { statusCode: 500 })
		}

		return urls
	}
}

type EncryptedStreamOptions = {
	saveOriginalFileIfRequired?: boolean
	logger?: Logger
	opts?: AxiosRequestConfig
}

export const getStream = async (item: WAMediaUpload, opts?: AxiosRequestConfig) => {
	if (Buffer.isBuffer(item)) {
		return { stream: toReadable(item), type: 'buffer' } as const
	}

	if ('stream' in item) {
		return { stream: item.stream, type: 'readable' } as const
	}

	if (item.url.toString().startsWith('http://') || item.url.toString().startsWith('https://')) {
		return { stream: await getHttpStream(item.url, opts), type: 'remote' } as const
	}

	return { stream: createReadStream(item.url), type: 'file' } as const
}

export const toReadable = (buffer: Buffer) => {
	const readable = new Readable({ read: () => {} })
	readable.push(buffer)
	readable.push(null)
	return readable
}

const getTmpFilesDirectory = () => tmpdir()

export const hkdfInfoKey = (type: MediaType) => {
	const hkdfInfo = MEDIA_HKDF_KEY_MAPPING[type]
	return `WhatsApp ${hkdfInfo} Keys`
}
/** generates all the keys required to encrypt/decrypt & sign a media message */
export async function getMediaKeys(
	buffer: Uint8Array | string | null | undefined,
	mediaType: MediaType
): Promise<MediaDecryptionKeyInfo> {
	if (!buffer) {
		throw new Boom('Cannot derive from empty media key')
	}

	if (typeof buffer === 'string') {
		buffer = Buffer.from(buffer.replace('data:;base64,', ''), 'base64')
	}

	// expand using HKDF to 112 bytes, also pass in the relevant app info
	const expandedMediaKey = await hkdf(buffer, 112, { info: hkdfInfoKey(mediaType) })
	return {
		iv: expandedMediaKey.slice(0, 16),
		cipherKey: expandedMediaKey.slice(16, 48),
		macKey: expandedMediaKey.slice(48, 80)
	}
}

export const encryptedStream = async (
	media: WAMediaUpload,
	mediaType: MediaType,
	{ logger, saveOriginalFileIfRequired, opts }: EncryptedStreamOptions = {}
) => {
	const { stream, type } = await getStream(media, opts)

	//logger?.debug('fetched media stream')

	const mediaKey = Crypto.randomBytes(32)
	const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, mediaType)

	const encFilePath = join(getTmpFilesDirectory(), mediaType + generateMessageIDV2() + '-enc')
	const encFileWriteStream = createWriteStream(encFilePath)

	let originalFileStream: WriteStream | undefined
	let originalFilePath: string | undefined

	if (saveOriginalFileIfRequired) {
		originalFilePath = join(getTmpFilesDirectory(), mediaType + generateMessageIDV2() + '-original')
		originalFileStream = createWriteStream(originalFilePath)
	}

	let fileLength = 0
	const aes = Crypto.createCipheriv('aes-256-cbc', cipherKey, iv)
	const hmac = Crypto.createHmac('sha256', macKey!).update(iv)
	const sha256Plain = Crypto.createHash('sha256')
	const sha256Enc = Crypto.createHash('sha256')

	const onChunk = (buff: Buffer) => {
		sha256Enc.update(buff)
		hmac.update(buff)
		encFileWriteStream.write(buff)
	}

	try {
		for await (const data of stream) {
			fileLength += data.length

			if (type === 'remote' && opts?.maxContentLength && fileLength + data.length > opts.maxContentLength) {
				throw new Boom(`content length exceeded when encrypting "${type}"`, {
					data: { media, type }
				})
			}

			if (originalFileStream) {
				if (!originalFileStream.write(data)) {
					await once(originalFileStream, 'drain')
				}
			}

			sha256Plain.update(data)
			onChunk(aes.update(data))
		}

		onChunk(aes.final())

		const mac = hmac.digest().slice(0, 10)
		sha256Enc.update(mac)

		const fileSha256 = sha256Plain.digest()
		const fileEncSha256 = sha256Enc.digest()

		encFileWriteStream.write(mac)

		encFileWriteStream.end()
		originalFileStream?.end?.()
		stream.destroy()

		//logger?.debug('encrypted data successfully')

		return {
			mediaKey,
			originalFilePath,
			encFilePath,
			mac,
			fileEncSha256,
			fileSha256,
			fileLength
		}
	} catch (error) {
		// destroy all streams with error
		encFileWriteStream.destroy()
		originalFileStream?.destroy?.()
		aes.destroy()
		hmac.destroy()
		sha256Plain.destroy()
		sha256Enc.destroy()
		stream.destroy()

		try {
			await fs.unlink(encFilePath)
			if (originalFilePath) {
				await fs.unlink(originalFilePath)
			}
		} catch (err) {
			//logger?.error({ err }, 'failed deleting tmp files')
		}

		throw error
	}
}

/** generates a thumbnail for a given media, if required */
export async function generateThumbnail(
	file: string,
	mediaType: 'video' | 'image',
	options: {
		logger?: Logger
	}
) {
	let thumbnail: string | undefined
	let originalImageDimensions: { width: number; height: number } | undefined
	if (mediaType === 'image') {
		const { buffer, original } = await extractImageThumb(file)
		thumbnail = buffer.toString('base64')
		if (original.width && original.height) {
			originalImageDimensions = {
				width: original.width,
				height: original.height
			}
		}
	} else if (mediaType === 'video') {
		const imgFilename = join(getTmpFilesDirectory(), generateMessageIDV2() + '.jpg')
		try {
			await extractVideoThumb(file, imgFilename, '00:00:00', { width: 32, height: 32 })
			const buff = await fs.readFile(imgFilename)
			thumbnail = buff.toString('base64')

			await fs.unlink(imgFilename)
		} catch (err) {
			//options.logger?.debug('could not generate video thumb: ' + err)
		}
	}

	return {
		thumbnail,
		originalImageDimensions
	}
}

/** Extracts video thumb using FFMPEG */
const extractVideoThumb = async (
	path: string,
	destPath: string,
	time: string,
	size: { width: number; height: number }
) =>
	new Promise<void>((resolve, reject) => {
		const cmd = `ffmpeg -ss ${time} -i ${path} -y -vf scale=${size.width}:-1 -vframes 1 -f image2 ${destPath}`
		exec(cmd, err => {
			if (err) {
				reject(err)
			} else {
				resolve()
			}
		})
	})