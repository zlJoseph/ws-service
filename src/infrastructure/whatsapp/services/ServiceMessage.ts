import { S_WHATSAPP_NET } from "../Defaults"
import { Message } from "../proto"
import { AuthenticationCreds, SignalKeyStoreWithTransaction } from "../types"
import { AnyMessageContent, MediaConnInfo, MessageRelayOptions, MiscMessageGenerationOptions, WAMediaUploadFunction } from "../types/Message"
import { SignalRepository } from "../types/Signal"
import { SocketConfig } from "../types/Socket"
import { encodeWAMessage, generateMessageIDV2 } from "../utils"
import { getUrlInfo } from "../utils/linkPreview"
import { generateWAMessage } from "../utils/messages"
import { getWAUploadToServer } from "../utils/messagesMedia"
import { extractDeviceJids, parseAndInjectE2ESessions } from "../utils/signal"
import { encodeSignedDeviceIdentity } from "../utils/validateConnection"
import { BinaryNode, BinaryNodeAttributes } from "../WABinary"
import { getBinaryNodeChild, getBinaryNodeChildren } from "../WABinary/genericUtils"
import { jidDecode, jidEncode, jidNormalizedUser, JidWithDevice } from "../WABinary/jid-utils"
import { USyncQuery, USyncQueryResult, USyncUser } from "../WAUSync"

export class ServiceMessage {
    private waUploadToServer: WAMediaUploadFunction
	private mediaConn!: Promise<MediaConnInfo>

    constructor(
        private config: SocketConfig,
        private authState: { creds: AuthenticationCreds; keys: SignalKeyStoreWithTransaction },
        private signalRepository: SignalRepository,
        private query: (node: BinaryNode, timeoutMs?: number) => Promise<any>,
        private sendNode: (frame: BinaryNode) => Promise<void>,
		private executeUSyncQuery: (usyncQuery: USyncQuery) => Promise<USyncQueryResult | undefined>
    ) {
        this.waUploadToServer = getWAUploadToServer(config, this.refreshMediaConn.bind(this))
    }

    async sendMessage(jid: string, content: AnyMessageContent, options: MiscMessageGenerationOptions = {}) {
        const userJid = this.authState.creds.me!.id

        const fullMsg = await generateWAMessage(jid, content, {
			logger: this.config.logger,
			userJid,
			getUrlInfo: text =>
			    getUrlInfo(text, {
							thumbnailWidth: this.config.linkPreviewImageThumbnailWidth,
							fetchOpts: {
								timeout: 3_000,
								...(this.config.options || {})
							},
							logger: this.config.logger,
							uploadImage: this.config.generateHighQualityLinkPreview ? this.waUploadToServer : undefined
			    }),
			//TODO: CACHE
			getProfilePicUrl: async () => {return ''},
			upload: this.waUploadToServer,
			mediaCache: this.config.mediaCache,
			options: this.config.options,
			messageId: generateMessageIDV2(this.authState.creds?.me?.id),
			...options
		})

        
		const isPollMessage = 'poll' in content && !!content.poll // Encuesta
		const additionalAttributes: BinaryNodeAttributes = {}
        const additionalNodes: BinaryNode[] = []

        if (isPollMessage) {
			additionalNodes.push({
				tag: 'meta',
				attrs: {
					polltype: 'creation'
				}
			} as BinaryNode)
		}

        await this.relayMessage(jid, fullMsg.message!, {
			messageId: fullMsg?.key?.id!,
			additionalAttributes,
			statusJidList: options.statusJidList,
			additionalNodes
		})
    }

    async relayMessage(
        jid: string,
		message: Message,
		{
			messageId: msgId,
			participant,
			additionalAttributes,
			additionalNodes,
			useUserDevicesCache
		}: MessageRelayOptions
    ){
        const meId = this.authState.creds.me!.id

		let shouldIncludeDeviceIdentity = false

		const { user, server } = jidDecode(jid)!
		const statusJid = 'status@broadcast'
		const isGroup = server === 'g.us'
		const isStatus = jid === statusJid
		const isLid = server === 'lid'

        msgId = msgId || generateMessageIDV2(this.authState.creds.me?.id)
		useUserDevicesCache = useUserDevicesCache !== false
		//useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus

        const participants: BinaryNode[] = []
		const destinationJid = !isStatus ? jidEncode(user, isLid ? 'lid' : isGroup ? 'g.us' : 's.whatsapp.net') : statusJid
		const binaryNodeContent: BinaryNode[] = []
		const devices: JidWithDevice[] = []

		const meMsg: Message = {
			deviceSentMessage: {
				destinationJid,
				message
			}
		}
        const extraAttrs = {} as any

        await this.authState.keys.transaction(async () => {
            const mediaType = this.getMediaType(message)
			if (mediaType) {
				extraAttrs['mediatype'] = mediaType
			}

			/*if (normalizeMessageContent(message)?.pinInChatMessage) {
				extraAttrs['decrypt-fail'] = 'hide'
			}*/

            if (isGroup || isStatus) {

            }else{
                const { user: meUser } = jidDecode(meId)!

				if (!participant) {
					devices.push({ user })
					if (user !== meUser) {
						devices.push({ user: meUser })
					}

					if (additionalAttributes?.['category'] !== 'peer') { // ¿con esto envía notificaciones?
						const additionalDevices = await this.getUSyncDevices([meId, jid], /*!!useUserDevicesCache*/ false, true)
						//console.log(additionalDevices);
						devices.push(...additionalDevices)
					}
				}

				const allJids: string[] = []
				const meJids: string[] = []
				const otherJids: string[] = []
				for (const { user, device } of devices) {
					const isMe = user === meUser
					const jid = jidEncode(
						isMe && isLid ? this.authState.creds?.me?.lid!.split(':')[0] || user : user,
						isLid ? 'lid' : 's.whatsapp.net',
						device
					)
					if (isMe) {
						meJids.push(jid)
					} else {
						otherJids.push(jid)
					}

					allJids.push(jid)
				}

				await this.assertSessions(allJids, false)

				const [
					{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 },
					{ nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }
				] = await Promise.all([
					this.createParticipantNodes(meJids, meMsg, extraAttrs),
					this.createParticipantNodes(otherJids, message, extraAttrs)
				])
				participants.push(...meNodes)
				participants.push(...otherNodes)

				shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2
            }

			if (participants.length) {
				if (additionalAttributes?.['category'] === 'peer') {
					const peerNode = participants[0]?.content?.[0] as BinaryNode
					if (peerNode) {
						binaryNodeContent.push(peerNode) // push only enc
					}
				} else {
					binaryNodeContent.push({
						tag: 'participants',
						attrs: {},
						content: participants
					})
				}
			}

            const stanza: BinaryNode = {
				tag: 'message',
				attrs: {
					id: msgId,
					type: this.getMessageType(message),
					...(additionalAttributes || {})
				},
				content: binaryNodeContent
			}

            if (participant) {

            }else{
				stanza.attrs.to = destinationJid
            }

            if (shouldIncludeDeviceIdentity) {
				;(stanza.content as BinaryNode[]).push({
					tag: 'device-identity',
					attrs: {},
					content: encodeSignedDeviceIdentity(this.authState.creds.account!, true)
				})

				//this.config.logger.debug({ jid }, 'adding device identity')
			}

			if (additionalNodes && additionalNodes.length > 0) {
				;(stanza.content as BinaryNode[]).push(...additionalNodes)
			}

			//this.config.logger.debug({ msgId }, `sending message to ${participants.length} devices`)

			//this.config.logger.debug({ stanza }, `sending messge payload`)
			
			await this.sendNode(stanza)
        })

    }

    getMessageType (message: Message){
		if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
			return 'poll'
		}

		return 'text'
	}

    getMediaType(message: Message) {
        if (message.imageMessage) {
			return 'image'
		} else if (message.videoMessage) {
			return message.videoMessage.gifPlayback ? 'gif' : 'video'
		} else if (message.audioMessage) {
			return message.audioMessage.ptt ? 'ptt' : 'audio'
		} else if (message.contactMessage) {
			return 'vcard'
		} else if (message.documentMessage) {
			return 'document'
		} else if (message.contactsArrayMessage) {
			return 'contact_array'
		} else if (message.liveLocationMessage) {
			return 'livelocation'
		} else if (message.stickerMessage) {
			return 'sticker'
		} else if (message.listMessage) {
			return 'list'
		} else if (message.listResponseMessage) {
			return 'list_response'
		} else if (message.buttonsResponseMessage) {
			return 'buttons_response'
		} else if (message.orderMessage) {
			return 'order'
		} else if (message.productMessage) {
			return 'product'
		} else if (message.interactiveResponseMessage) {
			return 'native_flow_response'
		} else if (message.groupInviteMessage) {
			return 'url'
		}
    }

    async assertSessions (jids: string[], force: boolean) {
		let didFetchNewSession = false
		let jidsRequiringFetch: string[] = []
		if (force) {
			jidsRequiringFetch = jids
		} else {
			const addrs = jids.map(jid => this.signalRepository.jidToSignalProtocolAddress(jid))
			const sessions = await this.authState.keys.get('session', addrs)
			for (const jid of jids) {
				const signalId = this.signalRepository.jidToSignalProtocolAddress(jid)
				if (!sessions[signalId]) {
					jidsRequiringFetch.push(jid)
				}
			}
		}

		if (jidsRequiringFetch.length) {
			//this.config.logger.debug({ jidsRequiringFetch }, 'fetching sessions')
			const result = await this.query({
				tag: 'iq',
				attrs: {
					xmlns: 'encrypt',
					type: 'get',
					to: S_WHATSAPP_NET
				},
				content: [
					{
						tag: 'key',
						attrs: {},
						content: jidsRequiringFetch.map(jid => ({
							tag: 'user',
							attrs: { jid }
						}))
					}
				]
			})
			await parseAndInjectE2ESessions(result, this.signalRepository)

			didFetchNewSession = true
		}

		return didFetchNewSession
	}

    async createParticipantNodes(jids: string[], message: Message, extraAttrs?: BinaryNode['attrs']) {
		let patched = await this.config.patchMessageBeforeSending(message, jids)
		if (!Array.isArray(patched)) {
			patched = jids ? jids.map(jid => ({ recipientJid: jid, ...patched })) : [patched]
		}

		let shouldIncludeDeviceIdentity = false

		const nodes = await Promise.all(
			patched.map(async patchedMessageWithJid => {
				const { recipientJid: jid, ...patchedMessage } = patchedMessageWithJid
				if (!jid) {
					return {} as BinaryNode
				}

				const bytes = encodeWAMessage(patchedMessage)
				const { type, ciphertext } = await this.signalRepository.encryptMessage({ jid, data: bytes })
				if (type === 'pkmsg') {
					shouldIncludeDeviceIdentity = true
				}

				const node: BinaryNode = {
					tag: 'to',
					attrs: { jid },
					content: [
						{
							tag: 'enc',
							attrs: {
								v: '2',
								type,
								...(extraAttrs || {})
							},
							content: ciphertext
						}
					]
				}
				return node
			})
		)
		return { nodes, shouldIncludeDeviceIdentity }
	}

	async getUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean) {
		const deviceResults: JidWithDevice[] = []

		if (!useCache) {
			//this.config.logger.debug('not using cache for devices')
		}

		const toFetch: string[] = []
		jids = Array.from(new Set(jids))

		for (let jid of jids) {
			const user = jidDecode(jid)?.user
			jid = jidNormalizedUser(jid)
			if (useCache) {
				/*const devices = userDevicesCache.get<JidWithDevice[]>(user!)
				if (devices) {
					deviceResults.push(...devices)

					this.config.logger.trace({ user }, 'using cache for devices')
				} else {
					toFetch.push(jid)
				}*/
			} else {
				toFetch.push(jid)
			}
		}

		if (!toFetch.length) {
			return deviceResults
		}

		const query = new USyncQuery().withContext('message').withDeviceProtocol()

		for (const jid of toFetch) {
			query.withUser(new USyncUser().withId(jid))
		}

		const result = await this.executeUSyncQuery(query)

		if (result) {
			const extracted = extractDeviceJids(result?.list, this.authState.creds.me!.id, ignoreZeroDevices)
			const deviceMap: { [_: string]: JidWithDevice[] } = {}

			for (const item of extracted) {
				deviceMap[item.user] = deviceMap[item.user] || []
				deviceMap[item.user].push(item)

				deviceResults.push(item)
			}

			for (const key in deviceMap) {
				//userDevicesCache.set(key, deviceMap[key])
			}
		}

		return deviceResults
	}

	async refreshMediaConn(forceGet = false): Promise<MediaConnInfo>{
		const media = await this.mediaConn

		if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
			this.mediaConn = (async () => {
				const result = await this.query({
					tag: 'iq',
					attrs: {
						type: 'set',
						xmlns: 'w:m',
						to: S_WHATSAPP_NET
					},
					content: [{ tag: 'media_conn', attrs: {} }]
				})
				const mediaConnNode = getBinaryNodeChild(result, 'media_conn')
				const node: MediaConnInfo = {
					hosts: getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
						hostname: attrs.hostname,
						maxContentLengthBytes: +attrs.maxContentLengthBytes
					})),
					auth: mediaConnNode!.attrs.auth,
					ttl: +mediaConnNode!.attrs.ttl,
					fetchDate: new Date()
				}
				//logger.debug('fetched media conn')
				return node
			})()
		}

		return this.mediaConn
	}
}