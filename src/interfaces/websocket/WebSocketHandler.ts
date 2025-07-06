import WebSocket from 'ws';
import { IncomingMessage } from 'src/domain/valueObjects';
import type { ProcessClientStepUseCase } from '../../application/useCases/ProcessClientStepUseCase';
import type { ClientWsPort, Logger } from 'src/application/ports/output';
import type { AuthenticatedWebSocket } from './types';
import { IncomingMessageMapper } from 'src/infrastructure/mapper';

export class WebSocketHandler implements ClientWsPort {
	private processEvent!: ProcessClientStepUseCase;
	private clients: Map<string, AuthenticatedWebSocket> = new Map();

	constructor(private logger: Logger) {}

	setProcessEvent(processEvent: ProcessClientStepUseCase) {
		this.processEvent = processEvent;
	}

	handleConnection(ws: AuthenticatedWebSocket) {
		ws.on('message', (data: WebSocket.RawData) => {
			void (async () => {
				try {
					const dto = IncomingMessageMapper.fromRawData(data);
					const message: IncomingMessage = IncomingMessage.fromObject(dto);

					if (message.isConnect()) {
						if (!this.clients.has(ws.workSessionAuth.Token))
							this.clients.set(ws.workSessionAuth.Token, ws);

						await this.processEvent.connect(ws.workSessionAuth);
					}

					if (message.isProcess()) {
						await this.processEvent.sendMessage(ws.uuid, ws.workSessionAuth, message);
					}
					// Deslogearse
				} catch (err) {
					this.logger.error('[ws-server] Error procesando evento:', err);
				}
			});
		});

		ws.on('close', () => {
			void (async () => {
				for (const [session, socket] of this.clients.entries()) {
					if (socket === ws) {
						await this.processEvent.disconnect(socket.workSessionAuth);
						this.clients.delete(session);
						break;
					}
				}
			});
		});

		ws.send(JSON.stringify({ type: 'ready' }));
	}

	async shutdown() {
		await this.processEvent.disconnectAll();
		this.clients.clear();
	}

	sendToClient(sessionId: string, payload: any) {
		const socket = this.clients.get(sessionId);
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(payload));
		} else {
			this.logger.warn(`No se pudo enviar a cliente ${sessionId}`);
		}
	}
}
