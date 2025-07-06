import { makeLibSignalRepository } from "../Signal/libsignal"
import { MediaType } from "../types/Message"
import { SocketConfig, WAVersion } from "../types/Socket"
import { Browsers } from "../utils"

export const DICT_VERSION = 2
export const NOISE_WA_HEADER = Buffer.from(
	[ 87, 65, 6, DICT_VERSION ]
)
export const DEF_CALLBACK_PREFIX = 'CB:'
export const DEF_TAG_PREFIX = 'TAG:'
export const MIN_PREKEY_COUNT = 5
export const INITIAL_PREKEY_COUNT = 30

export const DEFAULT_CACHE_TTLS = {
	SIGNAL_STORE: 5 * 60, // 5 minutes
	MSG_RETRY: 60 * 60, // 1 hour
	CALL_OFFER: 5 * 60, // 5 minutes
	USER_DEVICES: 5 * 60 // 5 minutes
}

export const DEFAULT_ORIGIN = 'https://web.whatsapp.com'

export const MEDIA_HKDF_KEY_MAPPING = {
	audio: 'Audio',
	document: 'Document',
	image: 'Image',
	ppic: '',
	ptt: 'Audio',
	sticker: 'Image',
	video: 'Video',
	'thumbnail-document': 'Document Thumbnail',
	'thumbnail-image': 'Image Thumbnail',
	'thumbnail-video': 'Video Thumbnail',
	'thumbnail-link': 'Link Thumbnail',
	'md-msg-hist': 'History',
	'md-app-state': 'App State',
	'product-catalog-image': '',
	'payment-bg-image': 'Payment Background',
	ptv: 'Video'
}

export const WA_DEFAULT_EPHEMERAL = 7 * 24 * 60 * 60

/** from: https://stackoverflow.com/questions/3809401/what-is-a-good-regular-expression-to-match-a-url */
export const URL_REGEX = /https:\/\/(?![^:@\/\s]+:[^:@\/\s]+@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?/g

export const MEDIA_PATH_MAP: { [T in MediaType]?: string } = {
	image: '/mms/image',
	video: '/mms/video',
	document: '/mms/document',
	audio: '/mms/audio',
	sticker: '/mms/image',
	'thumbnail-link': '/mms/image',
	'product-catalog-image': '/product/image',
	'md-app-state': '',
	'md-msg-hist': '/mms/md-app-state'
}

export const MEDIA_KEYS = Object.keys(MEDIA_PATH_MAP) as MediaType[]

const version = [2, 3000, 1023223821]

export const DEFAULT_CONNECTION_CONFIG: SocketConfig = {
	workSession:{ 
		Token: '', 
		WhatsAppNumbers: [''], 
		UploadedCSVName: '', 
		UploadedCSVUrl: '', 
		UploadedZipName: '', 
		UploadedZipUrl: '', 
		Active: false
	},
	version: version as WAVersion,
	browser: Browsers.ubuntu('Chrome'),
	waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
	connectTimeoutMs: 20_000,
	keepAliveIntervalMs: 30_000,
	defaultQueryTimeoutMs: 60_000,
	customUploadHosts: [],
	patchMessageBeforeSending: msg => msg,
	transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
	linkPreviewImageThumbnailWidth: 192,
	generateHighQualityLinkPreview: false,
	options: { },
	countryCode: 'US',
	makeSignalRepository: makeLibSignalRepository
}

export const NOISE_MODE = 'Noise_XX_25519_AESGCM_SHA256\0\0\0\0'
export const WA_CERT_DETAILS = {
	SERIAL: 0,
}

export const S_WHATSAPP_NET = '@s.whatsapp.net'
export const OFFICIAL_BIZ_JID = '16505361212@c.us'
export const SERVER_JID = 'server@c.us'
export const PSA_WID = '0@c.us'
export const STORIES_JID = 'status@broadcast'