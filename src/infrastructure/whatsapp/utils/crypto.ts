import * as libsignal from '@whiskeysockets/libsignal-node'
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'crypto'
import HKDF from 'futoin-hkdf'
import { KeyPair } from '../types'

const GCM_TAG_LENGTH = 128 >> 3
export const KEY_BUNDLE_TYPE = Buffer.from([5])

/** prefix version byte to the pub keys, required for some curve crypto functions */
export const generateSignalPubKey = (pubKey: Uint8Array | Buffer) => (
	pubKey.length === 33
		? pubKey
		: Buffer.concat([ KEY_BUNDLE_TYPE, pubKey ])
)

export const Curve = {
	generateKeyPair: (): KeyPair => {
		const { pubKey, privKey } = libsignal.curve.generateKeyPair()
		return {
			private: Buffer.from(privKey),
			// remove version byte
			public: Buffer.from((pubKey as Uint8Array).slice(1))
		}
	},
    sharedKey: (privateKey: Uint8Array, publicKey: Uint8Array) => {
		const shared = libsignal.curve.calculateAgreement(generateSignalPubKey(publicKey), privateKey)
		return Buffer.from(shared)
	},
	sign: (privateKey: Uint8Array, buf: Uint8Array) => (
		libsignal.curve.calculateSignature(privateKey, buf)
	),
	verify: (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => {
		try {
			libsignal.curve.verifySignature(generateSignalPubKey(pubKey), message, signature)
			return true
		} catch (error) {
			return false
		}
	}
}

export const signedKeyPair = (identityKeyPair: KeyPair, keyId: number) => {
	const preKey = Curve.generateKeyPair()
	const pubKey = generateSignalPubKey(preKey.public)

	const signature = Curve.sign(identityKeyPair.private, pubKey)

	return { keyPair: preKey, signature, keyId }
}

/**
 * encrypt AES 256 GCM;
 * where the tag tag is suffixed to the ciphertext
 * */
export function aesEncryptGCM(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array) {
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	cipher.setAAD(additionalData)
	return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

/**
 * decrypt AES 256 GCM;
 * where the auth tag is suffixed to the ciphertext
 * */
export function aesDecryptGCM(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array) {
	const decipher = createDecipheriv('aes-256-gcm', key, iv)
	// decrypt additional adata
	const enc = ciphertext.slice(0, ciphertext.length - GCM_TAG_LENGTH)
	const tag = ciphertext.slice(ciphertext.length - GCM_TAG_LENGTH)
	// set additional data
	decipher.setAAD(additionalData)
	decipher.setAuthTag(tag)

	return Buffer.concat([ decipher.update(enc), decipher.final() ])
}

export function sha256(buffer: Uint8Array) {
	return createHash('sha256').update(buffer).digest()
}

// HKDF key expansion
export function hkdf(buffer: Uint8Array | Buffer, expandedLength: number, info: { salt?: Buffer, info?: string }) {
	return HKDF(!Buffer.isBuffer(buffer) ? Buffer.from(buffer) : buffer, expandedLength, info)
}

// sign HMAC using SHA 256
export function hmacSign(
	buffer: Buffer | Uint8Array,
	key: Buffer | Uint8Array,
	variant: 'sha256' | 'sha512' = 'sha256'
) {
	return createHmac(variant, key).update(buffer).digest()
}