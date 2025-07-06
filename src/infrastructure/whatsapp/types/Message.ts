import { AxiosRequestConfig } from "axios";
import { ContextInfo, Message, Message_ExtendedTextMessage, Message_ImageMessage, MessageKey, UserReceipt, WebMessageInfo, WebMessageInfo_Status, WebMessageInfo_StubType } from "../proto";
import { CacheStore } from "./Socket";
import { MEDIA_HKDF_KEY_MAPPING } from "../Defaults";
import { Readable } from "stream";
import { BinaryNode } from "../WABinary";
import { Logger } from "src/application/ports/output";

export type MinimalMessage = Pick<WebMessageInfo, 'key' | 'messageTimestamp'>

export type MediaConnInfo = {
    auth: string
    ttl: number
    hosts: { hostname: string, maxContentLengthBytes: number }[]
    fetchDate: Date
}


export type WAMessage = WebMessageInfo
export type WAMessageContent = Message
export type MessageUserReceipt = UserReceipt
export const WAMessageStubType = WebMessageInfo_StubType
export type WAMessageKey = MessageKey
export type MessageUpsertType = 'append' | 'notify'
export type WAMessageUpdate = { update: Partial<WAMessage>; key: MessageKey }
export type MessageUserReceiptUpdate = { key: MessageKey; receipt: MessageUserReceipt }
export const WAMessageStatus = WebMessageInfo_Status
export type WATextMessage = Message_ExtendedTextMessage

type ViewOnce = {
	viewOnce?: boolean
}

export interface WAUrlInfo {
	'canonical-url': string
	'matched-text': string
	title: string
	description?: string
	jpegThumbnail?: Buffer
	highQualityThumbnail?: Message_ImageMessage
	originalThumbnailUrl?: string
}

// types to generate WA messages
type Mentionable = {
	/** list of jids that are mentioned in the accompanying text */
	mentions?: string[]
}

type Contextable = {
	/** add contextInfo to the message */
	contextInfo?: ContextInfo
}

type Editable = {
	edit?: WAMessageKey
}

export type PollMessageOptions = {
	name: string
	selectableCount?: number
	values: string[]
	/** 32 byte message secret to encrypt poll selections */
	messageSecret?: Uint8Array
	toAnnouncementGroup?: boolean
}

export type AnyRegularMessageContent = (
	| ({
			text: string
			linkPreview?: WAUrlInfo | null
	  }  & Mentionable &
			Contextable &
			Editable)
    | AnyMediaMessageContent
) &
	ViewOnce

export type AnyMessageContent =
	| AnyRegularMessageContent


type MinimalRelayOptions = {
	/** override the message ID with a custom provided string */
	messageId?: string
}

export type MiscMessageGenerationOptions = MinimalRelayOptions & {
	/** optional, if you want to manually set the timestamp of the message */
	timestamp?: Date
	/** the message you want to quote */
	quoted?: WAMessage
	/** disappearing messages settings */
	ephemeralExpiration?: number | string
	/** timeout for media upload to WA server */
	mediaUploadTimeoutMs?: number
	/** jid list of participants for status@broadcast */
	statusJidList?: string[]
	/** backgroundcolor for status */
	backgroundColor?: string
	/** font type for status */
	font?: number
	/** if it is broadcast */
	broadcast?: boolean
}

export type MediaType = keyof typeof MEDIA_HKDF_KEY_MAPPING

export type WAMediaUploadFunction = (
	encFilePath: string,
	opts: { fileEncSha256B64: string; mediaType: MediaType; timeoutMs?: number }
) => Promise<{ mediaUrl: string; directPath: string }>

export type MediaGenerationOptions = {
	logger?: Logger
	mediaTypeOverride?: MediaType
	upload: WAMediaUploadFunction
	/** cache media so it does not have to be uploaded again */
	mediaCache?: CacheStore

	mediaUploadTimeoutMs?: number

	options?: AxiosRequestConfig

	backgroundColor?: string

	font?: number
}
export type MessageContentGenerationOptions = MediaGenerationOptions & {
	getUrlInfo?: (text: string) => Promise<WAUrlInfo | undefined>
	getProfilePicUrl?: (jid: string, type: 'image' | 'preview') => Promise<string | undefined>
}
export type MessageGenerationOptionsFromContent = MiscMessageGenerationOptions & {
	userJid: string
}
export type MessageGenerationOptions = MessageContentGenerationOptions & MessageGenerationOptionsFromContent

type WithDimensions = {
	width?: number
	height?: number
}

export type WAMediaPayloadURL = { url: URL | string }
export type WAMediaPayloadStream = { stream: Readable }
export type WAMediaUpload = Buffer | WAMediaPayloadStream | WAMediaPayloadURL
export type AnyMediaMessageContent = (
	| ({
			image: WAMediaUpload
			caption?: string
			jpegThumbnail?: string
	  } & Mentionable &
			Contextable &
			WithDimensions)
	| ({
			video: WAMediaUpload
			caption?: string
			gifPlayback?: boolean
			jpegThumbnail?: string
			/** if set to true, will send as a `video note` */
			ptv?: boolean
	  } & Mentionable &
			Contextable &
			WithDimensions)
	| {
			audio: WAMediaUpload
			/** if set to true, will send as a `voice note` */
			ptt?: boolean
			/** optionally tell the duration of the audio */
			seconds?: number
	  }
	| ({
			sticker: WAMediaUpload
			isAnimated?: boolean
	  } & WithDimensions)
	| ({
			document: WAMediaUpload
			mimetype: string
			fileName?: string
			caption?: string
	  } & Contextable)
) & { mimetype?: string } & Editable

export type MediaDecryptionKeyInfo = {
	iv: Buffer
	cipherKey: Buffer
	macKey?: Buffer
}

export type MessageRelayOptions = MinimalRelayOptions & {
	/** only send to a specific participant; used when a message decryption fails for a single user */
	participant?: { jid: string; count: number }
	/** additional attributes to add to the WA binary node */
	additionalAttributes?: { [_: string]: string }
	additionalNodes?: BinaryNode[]
	/** should we use the devices cache, or fetch afresh from the server; default assumed to be "true" */
	useUserDevicesCache?: boolean
	/** jid list of participants for status@broadcast */
	statusJidList?: string[]
}