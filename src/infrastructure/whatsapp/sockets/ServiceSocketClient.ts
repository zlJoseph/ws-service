import { Boom } from "@hapi/boom";
import { ClientPayload, HandshakeMessage } from "../proto";
import { AuthenticationCreds, DisconnectReason, KeyPair, SignalKeyStoreWithTransaction } from "../types";
import { SocketConfig } from "../types/Socket";
import { addTransactionCapability, generateMdTagPrefix, getCodeFromWSError, getErrorCodeFromStreamError, promiseTimeout } from "../utils";
import { Curve } from "../utils/crypto";
import { WebSocketClient } from "./WebSocketClient";
import { makeNoiseHandler } from "../utils/noiseHandler";
import { DEF_CALLBACK_PREFIX, DEF_TAG_PREFIX, INITIAL_PREKEY_COUNT, MIN_PREKEY_COUNT, NOISE_WA_HEADER, S_WHATSAPP_NET } from "../Defaults";
import { promisify } from "util";
import { configureSuccessfulPairing, generateLoginNode, generateRegistrationNode } from "../utils/validateConnection";
import { BinaryNode } from "../WABinary";
import { encodeBinaryNode } from "../WABinary/encode";
import { assertNodeErrorFree, binaryNodeToString, getBinaryNodeChild, getBinaryNodeChildren } from "../WABinary/genericUtils";
import { BaileysBufferableEventEmitter, makeEventBuffer } from "../utils/eventBuffer";
import { getNextPreKeysNode } from "../utils/signal";
import { ServiceMessage } from "../services/ServiceMessage";
import { SignalRepository } from "../types/Signal";
import { USyncQuery } from "../WAUSync";
import { Logger } from "src/application/ports/output";

interface ContactsSend {
    Numero: string
    Nombre: string
    Imagen: string
}

export class ServiceSocketClient{
    private logger!: Logger
    private ws: WebSocketClient
    private lastDateRecv!: Date
    private keepAliveReq!: NodeJS.Timeout
    private qrTimer!: NodeJS.Timeout
    private closed = false
    private sendPromise!: (arg1: string | Uint8Array<ArrayBufferLike>) => Promise<void>
    private ephemeralKeyPair!: KeyPair
    private noise!: any
    private keys!: SignalKeyStoreWithTransaction
    public ev!: BaileysBufferableEventEmitter
    private signalRepository!: SignalRepository

    constructor(private config: SocketConfig, private number: number){
        this.logger = this.config.logger!
        const url = typeof this.config.waWebSocketUrl === 'string' ? 
            new URL(this.config.waWebSocketUrl) 
            : this.config.waWebSocketUrl
            
        this.ws = new WebSocketClient(url, this.config)
        this.ev = makeEventBuffer(this.logger)
    }

    async startConnection(){
        this.ws.connect(this.number)
        
        this.ephemeralKeyPair = Curve.generateKeyPair()
        this.sendPromise = promisify(this.ws.send)

        this.noise = makeNoiseHandler({
            keyPair: this.ephemeralKeyPair,
            NOISE_HEADER: NOISE_WA_HEADER,
            logger: this.logger,
            routingInfo: this.config.auth?.creds?.routingInfo
        })

        this.keys = addTransactionCapability(this.config.auth!.keys, this.config.logger!, this.config.transactionOpts)
	    this.signalRepository = this.config.makeSignalRepository!({ creds: this.config.auth!.creds, keys: this.keys })

        this.ws.on('open', this.handleOpen.bind(this))
        this.ws.on('message', this.onMessageReceived.bind(this))
	    this.ws.on('error', this.mapWebSocketError(this.endAll).bind(this))
	    this.ws.on('close',  this.handleClose.bind(this))
        this.ws.on('CB:xmlstreamend', this.handleCloseByServer.bind(this))
        this.ws.on('CB:iq,type:set,pair-device', this.handlePairDevice.bind(this)) // Generar QR
        this.ws.on('CB:iq,,pair-success', this.handlePairSuccess.bind(this)) // Emparejamiento con dispositivo
        this.ws.on('CB:success', this.handleSuccess.bind(this)) // Conectado exitosamente
        this.ws.on('CB:stream:error', this.handleStreamError.bind(this)) // 515: reintentar logearse por qr

        this.ev.on('creds.update', this.handleCredsUpdateSession.bind(this))
    }

    private async handleOpen() {
		try {
            await this.validateConnection()
        } catch(err: any) {
            console.log(err);
            this.logger.error('error in validating connection', { err })
            this.endAll(err)
        }
	};

    async validateConnection(){
        let helloMsg: HandshakeMessage = {
            clientHello: { ephemeral: this.ephemeralKeyPair.public }
        }
    
        this.logger.info(`connected to WA(${this.number})`, { helloMsg })
        
        const init = HandshakeMessage.encode(helloMsg).finish()
        
        const result = await this.awaitNextMessage<Uint8Array>(init)
        const handshake = HandshakeMessage.decode(result)
        
        this.logger.trace(`handshake recv from WA(${this.number})`, { handshake })        
    
        const keyEnc = this.noise.processHandshake(handshake, this.config.auth!.creds.noiseKey)
    
        let node: ClientPayload
        if(!this.config.auth?.creds.me) {
            node = generateRegistrationNode(this.config.auth!.creds, this.config)
            this.logger.info(`not logged in, attempting registration...(${this.number})`, { node })
        } else{
            node = generateLoginNode(this.config.auth.creds.me.id, this.config)
            this.logger.info(`logging in...(${this.number})`, { node })
        }
    
        const payloadEnc = this.noise.encrypt(
            ClientPayload.encode(node).finish()
        )
        
        await this.sendRawMessage(
            HandshakeMessage.encode({
                clientFinish: {
                    static: keyEnc,
                    payload: payloadEnc,
                },
            }).finish()
        )
        this.noise.finishInit()
        this.startKeepAliveRequest() //para mantener conectado con WS
    }

    async awaitNextMessage<T>(sendMsg?: Uint8Array){
        if(!this.ws.isOpen) {
            throw new Boom('Connection Closed', {
                statusCode: DisconnectReason.connectionClosed
            })
        }
    
        let onOpen: (data: T) => void
        let onClose: (err: Error) => void
    
        const result = promiseTimeout<T>(this.config.connectTimeoutMs, (resolve, reject) => {
            onOpen = resolve
            onClose = this.mapWebSocketError(reject)
            this.ws.on('frame', onOpen)
            this.ws.on('close', onClose)
            this.ws.on('error', onClose)
        }).finally(() => {
            this.ws.off('frame', onOpen)
            this.ws.off('close', onClose)
            this.ws.off('error', onClose)
        })
    
        if(sendMsg) {
            this.sendRawMessage(sendMsg).catch(onClose!)
        }
    
        return result
    }

    mapWebSocketError(handler: (err: Error) => void) {
        return (error: Error) => {
            handler(
                new Boom(
                    `WebSocket Error (${error})`,
                    { statusCode: getCodeFromWSError(error), data: error }
                )
            )
        }
    }

    private async handleClose(){
        this.endAll(new Boom('Connection Terminated', { statusCode: DisconnectReason.connectionClosed }))
    }

    private async handleCloseByServer(){
        this.endAll(new Boom('Connection Terminated by Server', { statusCode: DisconnectReason.connectionClosed }))
    }

    async sendRawMessage (data: Uint8Array | Buffer) {
        if(!this.ws.isOpen) {
            throw new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
        }
    
        const bytes = this.noise.encodeFrame(data)
        await promiseTimeout<void>(this.config.connectTimeoutMs,
            async(resolve, reject) => {
                try {
                    await this.sendPromise.call(this.ws, bytes)
                    resolve()
                } catch(error) {
                    this.logger.error(`Error sendRawMessage(${this.number})`, error)
                    reject(error)
                }
            }
        )
    }

    startKeepAliveRequest(): void {
        this.keepAliveReq = setInterval(() => {
            if (!this.lastDateRecv) {
                this.lastDateRecv = new Date();
            }

            const diff = Date.now() - this.lastDateRecv.getTime();

            // Si ha pasado demasiado tiempo desde la última respuesta del servidor, consideramos que se perdió la conexión
            if (diff > this.config.keepAliveIntervalMs + 5000) {
                this.endAll(new Boom('Connection was lost', { statusCode: DisconnectReason.connectionLost }));
            } else if (this.ws.isOpen) {
                // Si todo está bien, enviamos una solicitud de keep-alive
                this.query({
                    tag: 'iq',
                    attrs: {
                        id: this.generateMessageTag(),
                        to: S_WHATSAPP_NET,
                        type: 'get',
                        xmlns: 'w:p',
                    },
                    content: [{ tag: 'ping', attrs: {} }],
                }).catch((err: Error) => {
                    this.logger.error(`error in sending keep alive(${this.number})`, { trace: err.stack });
                });
            } else {
                this.logger.warn(`keep alive called when WS not open(${this.number})`);
            }
        }, this.config.keepAliveIntervalMs);
    }

    generateMessageTag(){
        let epoch = 1
        const uqTagId = generateMdTagPrefix()
        return `${uqTagId}${epoch++}`
    }

    query = async (node: BinaryNode, timeoutMs?: number) => {
        if (!node.attrs.id) {
            node.attrs.id = this.generateMessageTag()
        }
    
        const msgId = node.attrs.id
    
        const [result] = await Promise.all([this.waitForMessage(msgId, timeoutMs), this.sendNode(node)])
    
        if ('tag' in result) {
            assertNodeErrorFree(result)
        }
    
        return result
    }

    /**
    * Wait for a message with a certain tag to be received
    * @param msgId the message tag to await
    * @param timeoutMs timeout after which the promise will reject
    */
    async waitForMessage<T>(msgId: string, timeoutMs = this.config.defaultQueryTimeoutMs){
        let onRecv: (json: any) => void
        let onErr: (err: any) => void
        try {
            const result = await promiseTimeout<T>(timeoutMs, (resolve, reject) => {
                onRecv = resolve
                onErr = err => {
                    reject(err || new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed }))
                }
    
                this.ws.on(`TAG:${msgId}`, onRecv)
                this.ws.on('close', onErr) // if the socket closes, you'll never receive the message
                this.ws.off('error', onErr)
            })
    
            return result as any
        } finally {
            this.ws.off(`TAG:${msgId}`, onRecv!)
            this.ws.off('close', onErr!) // if the socket closes, you'll never receive the message
            this.ws.off('error', onErr!)
        }
    }

    /** send a binary node */
    sendNode(frame: BinaryNode){
        this.logger.trace('xml send', { xml: binaryNodeToString(frame)})

        const buff = encodeBinaryNode(frame)
        return this.sendRawMessage(buff)
    }

    async endAll(error: Error | undefined){
        if (this.closed) {
            this.logger.trace('connection already closed', { trace: error?.stack })
            return
        }

        this.closed = true
        this.logger.info(error ? 'connection errored' : 'connection closed', { trace: error?.stack })

        clearInterval(this.keepAliveReq)
        clearTimeout(this.qrTimer)

        this.ws.removeAllListeners('close')
        this.ws.removeAllListeners('error')
        this.ws.removeAllListeners('open')
        this.ws.removeAllListeners('message')
        this.ws.removeAllListeners()

        if (!this.ws.isClosed && !this.ws.isClosing) {
            try {
                await this.ws.close()
            } catch {}
        }

        this.ev.emit('connection.update', { session: this.config.workSession, 
            update : {
                connection: 'close',
                lastDisconnect: {
                    error,
                    date: new Date()
                }
            }
        })

        this.ev.removeAllListeners('connection.update')
        this.ev.removeAllListeners('creds.update')
        this.ev.removeAllListeners('print.qr')
        //this.ev.removeAllListeners('send.wa_connected')
    }

    onMessageReceived(data: Buffer) {
        this.noise.decodeFrame(data, (frame: any) => {
            // reset ping timeout
            this.lastDateRecv = new Date()
    
            let anyTriggered = false
    
            anyTriggered = this.ws.emit('frame', frame)
            // if it's a binary node
            if(!(frame instanceof Uint8Array)) {
                const msgId = frame.attrs.id
    
                this.logger.trace('recv xml', { xml: binaryNodeToString(frame) })
    
                /* Check if this is a response to a message we sent */
                anyTriggered = this.ws.emit(`${DEF_TAG_PREFIX}${msgId}`, frame) || anyTriggered
                /* Check if this is a response to a message we are expecting */
                const l0 = frame.tag
                const l1 = frame.attrs || {}
                const l2 = Array.isArray(frame.content) ? frame.content[0]?.tag : ''
    
                for(const key of Object.keys(l1)) {
                    anyTriggered = this.ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}:${l1[key]},${l2}`, frame) || anyTriggered
                    anyTriggered = this.ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}:${l1[key]}`, frame) || anyTriggered
                    anyTriggered = this.ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}`, frame) || anyTriggered
                }
    
                anyTriggered = this.ws.emit(`${DEF_CALLBACK_PREFIX}${l0},,${l2}`, frame) || anyTriggered
                anyTriggered = this.ws.emit(`${DEF_CALLBACK_PREFIX}${l0}`, frame) || anyTriggered
    
                /*if(!anyTriggered && logger.level === 'debug') {
                    logger.debug({ unhandled: true, msgId, fromMe: false, frame }, 'communication recv')
                }*/
            }
        })
    }

    async handlePairDevice(stanza: BinaryNode){
        const iq: BinaryNode = {
                tag: 'iq',
                attrs: {
                    to: S_WHATSAPP_NET,
                    type: 'result',
                    id: stanza.attrs.id
                }
            }
        await this.sendNode(iq)

        const pairDeviceNode = getBinaryNodeChild(stanza, 'pair-device')
        const refNodes = getBinaryNodeChildren(pairDeviceNode, 'ref')
        const noiseKeyB64 = Buffer.from(this.config.auth!.creds.noiseKey.public).toString('base64')
        const identityKeyB64 = Buffer.from(this.config.auth!.creds.signedIdentityKey.public).toString('base64')
        const advB64 = this.config.auth!.creds.advSecretKey

        let qrMs = this.config.qrTimeout || 60_000 // time to let a QR live
        const genPairQR = () => {
            if (!this.ws.isOpen) {
                return
            }
    
            const refNode = refNodes.shift()
            if (!refNode) {
                this.endAll(new Boom('QR refs attempts ended', { statusCode: DisconnectReason.timedOut }))
                return
            }
    
            const ref = (refNode.content as Buffer).toString('utf-8')
            const qr = [ref, noiseKeyB64, identityKeyB64, advB64].join(',')
            
            this.ev.emit('print.qr', { 
                session: this.config.workSession.Token,
                payload: {
                    qr
                }
            })
    
            this.qrTimer = setTimeout(genPairQR, qrMs)
            qrMs = this.config.qrTimeout || 20_000 // shorter subsequent qrs
        }
    
        genPairQR()
    }

    async handlePairSuccess(stanza: BinaryNode){
        try {
            const { reply, creds: updatedCreds } = configureSuccessfulPairing(stanza, this.config.auth!.creds)
            
            /*logger.info(
                { me: updatedCreds.me, platform: updatedCreds.platform },
                'pairing configured successfully, expect to restart the connection...'
            )*/

            //console.log('pairsuccess: ', updatedCreds);
            
    
            this.ev.emit('creds.update', updatedCreds)
            this.ev.emit('connection.update', { session: this.config.workSession,
                update: {
                    isNewLogin: true, qr: undefined 
                }
            })
    
            await this.sendNode(reply)
        } catch (error: any) {
            //logger.info({ trace: error.stack }, 'error in pairing')
            this.endAll(error)
        }
    }

    handleStreamError(node: BinaryNode){
        const { reason, statusCode } = getErrorCodeFromStreamError(node)
        this.endAll(new Boom(`Stream Errored (${reason})`, { statusCode, data: node }))
    }

    async uploadPreKeysToServerIfRequired(){
		const preKeyCount = await this.getAvailablePreKeysOnServer()
		//logger.info(`${preKeyCount} pre-keys found on server`)
		if (preKeyCount <= MIN_PREKEY_COUNT) {
			await this.uploadPreKeys()
		}
	}

    async getAvailablePreKeysOnServer(){
		const result = await this.query({
			tag: 'iq',
			attrs: {
				id: this.generateMessageTag(),
				xmlns: 'encrypt',
				type: 'get',
				to: S_WHATSAPP_NET
			},
			content: [{ tag: 'count', attrs: {} }]
		})
		const countChild = getBinaryNodeChild(result, 'count')
		return +countChild!.attrs.value
	}

    /** generates and uploads a set of pre-keys to the server */
	async uploadPreKeys(count = INITIAL_PREKEY_COUNT){
		await this.keys.transaction(async () => {
			//logger.info({ count }, 'uploading pre-keys')
			const { update, node } = await getNextPreKeysNode({ creds: this.config.auth!.creds, keys: this.keys }, count)

			await this.query(node)
			this.ev.emit('creds.update', update)

			//logger.info({ count }, 'uploaded pre-keys')
		})
	}

    async sendPassiveIq(tag: 'passive' | 'active'){
		this.query({
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				xmlns: 'passive',
				type: 'set'
			},
			content: [{ tag, attrs: {} }]
		})
    }

    async handleSuccess(node: BinaryNode){
        await this.uploadPreKeysToServerIfRequired()
        await this.sendPassiveIq('active')
    
        //logger.info('opened connection to WA')
        clearTimeout(this.qrTimer) // will never happen in all likelyhood -- but just in case WA sends success on first try
        
        //console.log('login complete: ', this.config.auth!.creds);
        
        const contact = { ...this.config.auth!.creds.me!, lid: node.attrs.lid }

        this.ev.emit('creds.update', { me: contact })
        this.ev.emit('connection.update', { session: this.config.workSession,  
            update: { connection: 'open', legacy: { phoneConnected: true, user: contact } }
        })
    }

    async handleSendMessageToNumber(payload: {message: string, numero: string, withImage: boolean, image: Buffer<ArrayBufferLike> | null}){
        const serviceMessage = new ServiceMessage(this.config, { creds: this.config.auth!.creds, keys: this.keys }, this.signalRepository, this.query, this.sendNode.bind(this), this.executeUSyncQuery.bind(this))
        if(payload.withImage && !!payload.image){
            await serviceMessage.sendMessage(payload.numero+"@s.whatsapp.net", { image: payload.image, caption: payload.message })
        }else{
            await serviceMessage.sendMessage(payload.numero+"@s.whatsapp.net", { text: payload.message})
        }

        /*const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        for (const contact of contacts) {
            const personalizedMessage = this.replaceTemplate(message, contact);
            await serviceMessage.sendMessage(contact.Numero+"@s.whatsapp.net", { image: readFileSync(contact.Imagen), caption: personalizedMessage })
            await sleep(100)
            //await serviceMessage.sendMessage(number+"@s.whatsapp.net", { text: message})
        }*/
    }

    async logout(){
        const jid = this.config.auth?.creds.me?.id
        if (jid) {
			await this.sendNode({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					id: this.generateMessageTag(),
					xmlns: 'md'
				},
				content: [
					{
						tag: 'remove-companion-device',
						attrs: {
							jid,
							reason: 'user_initiated'
						}
					}
				]
			})
		}

		this.endAll(new Boom('Intentional Logout', { statusCode: DisconnectReason.loggedOut }))
    }

    replaceTemplate(template: string, data: ContactsSend) {
        // Reemplaza variables en el mensaje, e.g.
        return template.replace(/\$(\w+)/g, (_, key: keyof ContactsSend) => data[key] || '');
    }
    /*obtenerRutaImagen(imagenesPath: string,numeroCelular: string) {
        const rutaCelular = path.join(imagenesPath, `${numeroCelular}.jpg`);
        const rutaAll = path.join(imagenesPath, 'all.jpg');

        if (existsSync(rutaCelular)) {
            return rutaCelular;
        }
        
        if (existsSync(rutaAll)) {
            return rutaAll;
        }

        return null;
    }*/

    async executeUSyncQuery(usyncQuery: USyncQuery){
		if (usyncQuery.protocols.length === 0) {
			throw new Boom('USyncQuery must have at least one protocol')
		}

		// todo: validate users, throw WARNING on no valid users
		// variable below has only validated users
		const validUsers = usyncQuery.users

		const userNodes = validUsers.map(user => {
			return {
				tag: 'user',
				attrs: {
					jid: !user.phone ? user.id : undefined
				},
				content: usyncQuery.protocols.map(a => a.getUserElement(user)).filter(a => a !== null)
			} as BinaryNode
		})

		const listNode: BinaryNode = {
			tag: 'list',
			attrs: {},
			content: userNodes
		}

		const queryNode: BinaryNode = {
			tag: 'query',
			attrs: {},
			content: usyncQuery.protocols.map(a => a.getQueryElement())
		}
		const iq = {
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				type: 'get',
				xmlns: 'usync'
			},
			content: [
				{
					tag: 'usync',
					attrs: {
						context: usyncQuery.context,
						mode: usyncQuery.mode,
						sid: this.generateMessageTag(),
						last: 'true',
						index: '0'
					},
					content: [queryNode, listNode]
				}
			]
		}

		const result = await this.query(iq)

		return usyncQuery.parseUSyncQueryResult(result)
	}

    isOpen(){
        return this.ws.isOpen
    }

    handleCredsUpdateSession(update: Partial<AuthenticationCreds>){
        const name = update.me?.name
        // if name has just been received
        if (this.config.auth!.creds.me?.name !== name) {
            //logger.debug({ name }, 'updated pushName')
            this.sendNode({
                tag: 'presence', attrs: { name: name! }
            }).catch(err => {
                console.log(err);
                //logger.warn({ trace: err.stack }, 'error in sending presence update on name change')
            })
        }

        Object.assign(this.config.auth!.creds, update)
    }

}