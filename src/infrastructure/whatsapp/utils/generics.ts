import { createHash, randomBytes } from "crypto"
import { BrowsersMap, DisconnectReason } from "../types"
import { platform, release } from "os"
import { Boom } from "@hapi/boom";
import { getAllBinaryNodeChildren } from "../WABinary/genericUtils";
import { BinaryNode } from "../WABinary";
import { jidDecode } from "../WABinary/jid-utils";
import { Message } from "../proto";

export async function promiseTimeout<T>(ms: number | undefined, promise: (resolve: (v: T) => void, reject: (error: any) => void) => void) {
	if(!ms) {
		return new Promise(promise)
	}

	const stack = new Error().stack
	// Create a promise that rejects in <ms> milliseconds
	const { delay, cancel } = delayCancellable(ms)
	const p = new Promise((resolve, reject) => {
		delay
			.then(() => reject(
				new Boom('Timed Out', {
					statusCode: DisconnectReason.timedOut,
					data: {
						stack
					}
				})
			))
			.catch (( err:any ) => reject(err))

		promise(resolve, reject)
	}).finally (cancel)
	return p as Promise<T>
}

export const delay = (ms: number) => delayCancellable(ms).delay

export const delayCancellable = (ms: number) => {
	const stack = new Error().stack
	let timeout: NodeJS.Timeout
	let reject: (error: any) => void
	const delay: Promise<void> = new Promise((resolve, _reject) => {
		timeout = setTimeout(resolve, ms)
		reject = _reject
	})
	const cancel = () => {
		clearTimeout (timeout)
		reject(
			new Boom('Cancelled', {
				statusCode: 500,
				data: {
					stack
				}
			})
		)
	}

	return { delay, cancel }
}

export const BufferJSON = {
	replacer: (_: any, value: any) => {
		if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
			return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') }
		}

		return value
	},

	reviver: (_: any, value: any) => {
		if (typeof value === 'object' && !!value && (value.buffer === true || value.type === 'Buffer')) {
			const val = value.data || value.value
			return typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || [])
		}

		return value
	}
}

export const generateRegistrationId = (): number => {
	return Uint16Array.from(randomBytes(2))[0] & 16383
}

/** unique message tag prefix for MD clients */
export const generateMdTagPrefix = () => {
	const bytes = randomBytes(4)
	return `${bytes.readUInt16BE()}.${bytes.readUInt16BE(2)}-`
}

const PLATFORM_MAP = {
	'aix': 'AIX',
	'darwin': 'Mac OS',
	'win32': 'Windows',
	'android': 'Android',
	'freebsd': 'FreeBSD',
	'openbsd': 'OpenBSD',
	'sunos': 'Solaris'
}

export const Browsers: BrowsersMap = {
	ubuntu: (browser) => ['WhatBot', browser, '1.0.0'],
	macOS: (browser) => ['Mac OS', browser, '14.4.1'],
	baileys: (browser) => ['Baileys', browser, '6.5.0'],
	windows: (browser) => ['Windows', browser, '10.0.22631'],
	/** The appropriate browser based on your OS & release */
	appropriate: (browser) => [ PLATFORM_MAP[platform() as keyof typeof PLATFORM_MAP] || 'Ubuntu', browser, release() ]
}

export const UNEXPECTED_SERVER_CODE_TEXT = 'Unexpected server response: '
export const getCodeFromWSError = (error: Error) => {
	let statusCode = 500
	if(error?.message?.includes(UNEXPECTED_SERVER_CODE_TEXT)) {
		const code = +error?.message.slice(UNEXPECTED_SERVER_CODE_TEXT.length)
		if(!Number.isNaN(code) && code >= 400) {
			statusCode = code
		}
	} else if(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(error as any)?.code?.startsWith('E')
		|| error?.message?.includes('timed out')
	) { // handle ETIMEOUT, ENOTFOUND etc
		statusCode = 408
	}

	return statusCode
}

export const encodeBigEndian = (e: number, t = 4) => {
	let r = e
	const a = new Uint8Array(t)
	for(let i = t - 1; i >= 0; i--) {
		a[i] = 255 & r
		r >>>= 8
	}

	return a
}

const CODE_MAP: { [_: string]: DisconnectReason } = {
	conflict: DisconnectReason.connectionReplaced
}

export const getErrorCodeFromStreamError = (node: BinaryNode) => {
	const [reasonNode] = getAllBinaryNodeChildren(node)
	let reason = reasonNode?.tag || 'unknown'
	const statusCode = +(node.attrs.code || CODE_MAP[reason] || DisconnectReason.badSession)

	if (statusCode === DisconnectReason.restartRequired) {
		reason = 'restart required'
	}

	return {
		reason,
		statusCode
	}
}

// inspired from whatsmeow code
// https://github.com/tulir/whatsmeow/blob/64bc969fbe78d31ae0dd443b8d4c80a5d026d07a/send.go#L42
export const generateMessageIDV2 = (userId?: string): string => {
	const data = Buffer.alloc(8 + 20 + 16)
	data.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)))

	if (userId) {
		const id = jidDecode(userId)
		if (id?.user) {
			data.write(id.user, 8)
			data.write('@c.us', 8 + id.user.length)
		}
	}

	const random = randomBytes(16)
	random.copy(data, 28)

	const hash = createHash('sha256').update(data).digest()
	return '3EB0' + hash.toString('hex').toUpperCase().substring(0, 18)
}

/** unix timestamp of a date in seconds */
export const unixTimestampSeconds = (date: Date = new Date()) => Math.floor(date.getTime() / 1000)

export const encodeWAMessage = (message: Message) => writeRandomPadMax16(Message.encode(message).finish())

export const writeRandomPadMax16 = (msg: Uint8Array) => {
	const pad = randomBytes(1)
	pad[0] &= 0xf
	if (!pad[0]) {
		pad[0] = 0xf
	}

	return Buffer.concat([msg, Buffer.alloc(pad[0], pad[0])])
}