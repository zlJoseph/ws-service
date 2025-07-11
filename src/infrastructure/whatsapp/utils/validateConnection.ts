import { createHash } from "crypto"
import { AuthenticationCreds, SignalCreds } from "../types"
import { SocketConfig } from "../types/Socket"
import { ADVDeviceIdentity, ADVSignedDeviceIdentity, ADVSignedDeviceIdentityHMAC, ClientPayload, ClientPayload_ConnectReason, ClientPayload_ConnectType, ClientPayload_UserAgent, ClientPayload_UserAgent_Platform, ClientPayload_UserAgent_ReleaseChannel, ClientPayload_WebInfo, ClientPayload_WebInfo_WebSubPlatform, DeviceProps, DeviceProps_PlatformType } from "../proto"
import { encodeBigEndian } from "./generics"
import { Curve, hmacSign, KEY_BUNDLE_TYPE } from "./crypto"
import { jidDecode } from "../WABinary/jid-utils"
import { BinaryNode } from "../WABinary"
import { getBinaryNodeChild } from "../WABinary/genericUtils"
import { Boom } from "@hapi/boom"
import { createSignalIdentity } from "./signal"

const getPlatformType = (platform: string): DeviceProps_PlatformType => {
	const platformType = platform.toUpperCase()
	return DeviceProps_PlatformType[platformType as keyof typeof DeviceProps_PlatformType] || DeviceProps_PlatformType.DESKTOP
}

const getUserAgent = (config: SocketConfig): ClientPayload_UserAgent => {
	return {
		appVersion: {
			primary: config.version[0],
			secondary: config.version[1],
			tertiary: config.version[2],
		},
		platform: ClientPayload_UserAgent_Platform.WEB,
		releaseChannel: ClientPayload_UserAgent_ReleaseChannel.RELEASE,
		osVersion: '0.1',
		device: 'Desktop',
		osBuildNumber: '0.1',
		localeLanguageIso6391: 'en',
		mnc: '000',
		mcc: '000',
		localeCountryIso31661Alpha2: config.countryCode,
	}
}

/*const PLATFORM_MAP = {
	'Mac OS': ClientPayload_WebInfo_WebSubPlatform.DARWIN,
	'Windows': ClientPayload_WebInfo_WebSubPlatform.WIN32
}*/

const getWebInfo = (config: SocketConfig): ClientPayload_WebInfo => {
	let webSubPlatform = ClientPayload_WebInfo_WebSubPlatform.WEB_BROWSER
	/*if(config.syncFullHistory && PLATFORM_MAP[config.browser[0]]) {
		webSubPlatform = PLATFORM_MAP[config.browser[0]]
	}*/

	return { webSubPlatform }
}

const getClientPayload = (config: SocketConfig) => {
	const payload: ClientPayload = {
		connectType: ClientPayload_ConnectType.WIFI_UNKNOWN,
		connectReason: ClientPayload_ConnectReason.USER_ACTIVATED,
		userAgent: getUserAgent(config),
        shards: []
	}

	payload.webInfo = getWebInfo(config)

	return payload
}

export const generateRegistrationNode = (
	{ registrationId, signedPreKey, signedIdentityKey }: SignalCreds,
	config: SocketConfig
) => {
	// the app version needs to be md5 hashed
	// and passed in
	const appVersionBuf = createHash('md5')
		.update(config.version.join('.')) // join as string
		.digest()

	const companion: DeviceProps = {
		os: config.browser[0],
		platformType: getPlatformType(config.browser[1]),
		//requireFullSync: config.syncFullHistory,
	}

	const companionProto = DeviceProps.encode(companion).finish()

	const registerPayload: ClientPayload = {
		...getClientPayload(config),
		passive: false,
		pull: false,
		devicePairingData: {
			buildHash: appVersionBuf,
			deviceProps: companionProto,
			eRegid: encodeBigEndian(registrationId),
			eKeytype: KEY_BUNDLE_TYPE,
			eIdent: signedIdentityKey.public,
			eSkeyId: encodeBigEndian(signedPreKey.keyId, 3),
			eSkeyVal: signedPreKey.keyPair.public,
			eSkeySig: signedPreKey.signature,
		},
	}

	return registerPayload
}

export const generateLoginNode = (userJid: string, config: SocketConfig): ClientPayload => {
	const { user, device } = jidDecode(userJid)!
	const payload: ClientPayload = {
		...getClientPayload(config),
		passive: false,
		pull: true,
		username: +user,
		device: device,
	}
	return payload
}

export const encodeSignedDeviceIdentity = (account: ADVSignedDeviceIdentity, includeSignatureKey: boolean) => {
	account = { ...account }
	// set to null if we are not to include the signature key
	// or if we are including the signature key but it is empty
	if (!includeSignatureKey || !account.accountSignatureKey?.length) {
		account.accountSignatureKey = undefined
	}

	return ADVSignedDeviceIdentity.encode(account).finish()
}

export const configureSuccessfulPairing = (
	stanza: BinaryNode,
	{
		advSecretKey,
		signedIdentityKey,
		signalIdentities
	}: Pick<AuthenticationCreds, 'advSecretKey' | 'signedIdentityKey' | 'signalIdentities'>
) => {
	const msgId = stanza.attrs.id

	const pairSuccessNode = getBinaryNodeChild(stanza, 'pair-success')

	const deviceIdentityNode = getBinaryNodeChild(pairSuccessNode, 'device-identity')
	const platformNode = getBinaryNodeChild(pairSuccessNode, 'platform')
	const deviceNode = getBinaryNodeChild(pairSuccessNode, 'device')
	const businessNode = getBinaryNodeChild(pairSuccessNode, 'biz')

	if (!deviceIdentityNode || !deviceNode) {
		throw new Boom('Missing device-identity or device in pair success node', { data: stanza })
	}

	const bizName = businessNode?.attrs.name
	const jid = deviceNode.attrs.jid

	const { details, hmac } = ADVSignedDeviceIdentityHMAC.decode(deviceIdentityNode.content as Buffer)
	// check HMAC matches
	const advSign = hmacSign(details!, Buffer.from(advSecretKey, 'base64'))
	if (Buffer.compare(hmac!, advSign) !== 0) {
		throw new Boom('Invalid account signature')
	}

	const account = ADVSignedDeviceIdentity.decode(details!)
	const { accountSignatureKey, accountSignature, details: deviceDetails } = account
	// verify the device signature matches
	const accountMsg = Buffer.concat([Buffer.from([6, 0]), deviceDetails!, signedIdentityKey.public])
	if (!Curve.verify(accountSignatureKey!, accountMsg, accountSignature!)) {
		throw new Boom('Failed to verify account signature')
	}

	// sign the details with our identity key
	const deviceMsg = Buffer.concat([Buffer.from([6, 1]), deviceDetails!, signedIdentityKey.public, accountSignatureKey!])
	account.deviceSignature = Curve.sign(signedIdentityKey.private, deviceMsg)

	const identity = createSignalIdentity(jid, accountSignatureKey!)
	const accountEnc = encodeSignedDeviceIdentity(account, false)

	const deviceIdentity = ADVDeviceIdentity.decode(account.details!)

	const S_WHATSAPP_NET = '@s.whatsapp.net'
	const reply: BinaryNode = {
		tag: 'iq',
		attrs: {
			to: S_WHATSAPP_NET,
			type: 'result',
			id: msgId
		},
		content: [
			{
				tag: 'pair-device-sign',
				attrs: {},
				content: [
					{
						tag: 'device-identity',
						attrs: { 'key-index': deviceIdentity.keyIndex!.toString() },
						content: accountEnc
					}
				]
			}
		]
	}

	const authUpdate: Partial<AuthenticationCreds> = {
		account,
		me: { id: jid, name: bizName },
		signalIdentities: [...(signalIdentities || []), identity],
		platform: platformNode?.attrs.name
	}

	return {
		creds: authUpdate,
		reply
	}
}