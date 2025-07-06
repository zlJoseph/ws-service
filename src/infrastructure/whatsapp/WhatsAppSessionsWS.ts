import { Boom } from "@hapi/boom";
import { ExternalWsEventHandlerPort, Logger, WhatsAppSessionsWSPort } from "src/application/ports";
import { WhatsAppWSClient } from "./WhatsAppWSClient";
import { DisconnectReason } from "./types";
import { WorkSessionAuth } from "src/domain/entities";
import { ConnectionStateSession } from "./types/Events";

export class WhatsAppSessionsWS implements WhatsAppSessionsWSPort {
    private eventHandler!: ExternalWsEventHandlerPort;
    private sessions = new Map<string, WhatsAppWSClient>(); // por cliente

    constructor(private logger: Logger) { }

    setEventHandler(handler: ExternalWsEventHandlerPort) {
        this.eventHandler = handler;
    }

    async connect(wsAuth: WorkSessionAuth, number = 1): Promise<void> {
        if (this.sessions.has(wsAuth.Token)) return;

        const wsClient = new WhatsAppWSClient(this.logger, wsAuth, number)
        await wsClient.init()

        wsClient.socket.ev.on('connection.update', this.handleConnectionUpdate.bind(this))

        wsClient.socket.ev.on('print.qr', this.handlePrintQR.bind(this))
        //wsClient.socket.ev.on('send.wa_connected', this.handleSendWAConnected.bind(this))
        this.sessions.set(wsAuth.Token, wsClient);
    }

    async sendMessage(wsAuth: WorkSessionAuth, payload: { message: string, numero: string, withImage: boolean, image: Buffer<ArrayBufferLike> | null }): Promise<void> {
        const ws = this.sessions.get(wsAuth.Token);
        if (!ws || !ws.socket.isOpen()) {
            throw new Error(`WS not connected for client ${wsAuth.Token}`);
        }
        await ws.handleSendMessage(payload);
    }

    async logout(wsAuth: WorkSessionAuth): Promise<void> {
        const whatsAppWS = this.sessions.get(wsAuth.Token);
        if (whatsAppWS) await whatsAppWS.logout();
        this.sessions.delete(wsAuth.Token);
    }

    async disconnect(wsAuth: WorkSessionAuth): Promise<void> {
        const whatsAppWS = this.sessions.get(wsAuth.Token);
        if (whatsAppWS) await whatsAppWS.close();
        this.sessions.delete(wsAuth.Token);
    }

    async disconnectAll(): Promise<void> {
        for (const [id, whatsAppWS] of this.sessions.entries()) {
            try {
                await whatsAppWS.close();
                this.sessions.delete(id);
            } catch (e) {
                this.logger.error(`Error al cerrar sesión ${id}:`, e)
            }
        }
    }

    async handleConnectionUpdate({ session, update }: ConnectionStateSession) {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            // reconnect if not logged out
            if ((lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.restartRequired) {
                if (this.sessions.get(session.Token)) this.sessions.delete(session.Token)
                await this.connect(session, 2)
            } else {
                this.logger.info('Connection closed. You are logged out.')
            }
        }

        if (connection === 'open') {
            if (update.legacy?.user) {
                const parteAntesDeArroba = update.legacy.user.id.split('@')[0];
                const numero = parteAntesDeArroba.split(':')[0];

                if (!session.WhatsAppNumbers.includes(numero)) {
                    const ws = this.sessions.get(session.Token);
                    if (ws && ws.socket.isOpen()) await ws.logout()

                    await this.eventHandler.sendNotificationClient(session.Token, { type: 'error', message: 'Número no permitido para conectarse' })
                    return;
                }

                await this.eventHandler.sendNotificationClient(session.Token, { type: 'connected', number: numero })
            }
        }
    }

    async handlePrintQR({ session, payload: { qr } }: { session: string, payload: { qr: string } }) {
        await this.eventHandler.sendNotificationClient(session, { type: 'qr', qr })
    }

    /*async handleSendWAConnected({session, payload: {connectedNumber}} : {session: string, payload: { connectedNumber: string }}){
        console.log('enviando numero: ' + connectedNumber);
        
        await this.eventHandler.sendNotificationClient(session, {type: 'connected', number: connectedNumber})
    }*/
}