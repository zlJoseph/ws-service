
import { AxiosRequestConfig } from 'axios'
import type { Agent } from 'https'
import type { URL } from 'url'
import { AuthenticationState, SignalAuthState, TransactionCapabilityOptions } from './Auth'
import { MediaConnInfo } from './Message'
import { SignalRepository } from './Signal'
import { Message } from '../proto'
import { WSAuth } from 'src/domain'
import { Logger } from 'src/application'

export type WAVersion = [number, number, number]
export type WABrowserDescription = [string, string, string]

export type PatchedMessageWithRecipientJID = Message & { recipientJid?: string }


/**
 waWebSocketUrl,
		connectTimeoutMs,
		logger,
		keepAliveIntervalMs,
		browser,
		auth: authState,
		printQRInTerminal,
		defaultQueryTimeoutMs,
		transactionOpts,
		qrTimeout,
		makeSignalRepository
 */

export type CacheStore = {
    /** get a cached key and change the stats */
    get<T>(key: string): T | undefined
    /** set a key in the cache */
    set<T>(key: string, value: T): void
    /** delete a key from the cache */
    del(key: string): void
    /** flush all data */
    flushAll(): void
}

export type SocketConfig = {
    workSession: WSAuth,
    /** the WS url to connect to WA */
    waWebSocketUrl: string | URL
    /** Fails the connection if the socket times out in this interval */
    connectTimeoutMs: number
    /** Default timeout for queries, undefined for no timeout */
    defaultQueryTimeoutMs: number | undefined
    /** ping-pong interval for WS connection */
    keepAliveIntervalMs: number
    /** proxy agent */
    agent?: Agent
    /** logger */
    logger?: Logger
    /** version to connect with */
    version: WAVersion
    /** override browser config */
    browser: WABrowserDescription
    /** agent used for fetch requests -- uploading/downloading media */
    fetchAgent?: Agent
    /** custom upload hosts to upload media to */
    customUploadHosts: MediaConnInfo['hosts']
    /** time to wait for the generation of the next QR in ms */
    qrTimeout?: number
    /** provide an auth state object to maintain the auth state */
    auth?: AuthenticationState
    /** transaction capability options for SignalKeyStore */
    transactionOpts: TransactionCapabilityOptions
    /** alphanumeric country code (USA -> US) for the number used */
    countryCode: string
    /** provide a cache to store media, so does not have to be re-uploaded */
    mediaCache?: CacheStore
    /** width for link preview images */
    linkPreviewImageThumbnailWidth: number
    /**
     * generate a high quality link preview,
     * entails uploading the jpegThumbnail to WA
     * */
    generateHighQualityLinkPreview: boolean

    /**
	 * Optionally patch the message before sending out
	 * */
	patchMessageBeforeSending: (
		msg: Message,
		recipientJids?: string[]
	) =>
		| Promise<PatchedMessageWithRecipientJID[] | PatchedMessageWithRecipientJID>
		| PatchedMessageWithRecipientJID[]
		| PatchedMessageWithRecipientJID

    /** options for axios */
    options: AxiosRequestConfig<{}>
    makeSignalRepository?: (auth: SignalAuthState) => SignalRepository
}
