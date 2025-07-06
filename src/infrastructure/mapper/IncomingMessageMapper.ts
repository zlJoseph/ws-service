import type { IncomingMessageDto } from 'src/application/dtos';
import type { WebSocket } from 'ws';

export class IncomingMessageMapper {
	static fromRawData(data: WebSocket.RawData): IncomingMessageDto {
		let raw: string;

		if (typeof data === 'string') {
			raw = data;
		} else if (Buffer.isBuffer(data)) {
			raw = data.toString('utf8');
		} else {
			throw new Error(`[ws] RawData no soportado: ${typeof data}`);
		}

		const parsed = JSON.parse(raw) as Record<string, unknown>;

		if (!parsed.type || typeof parsed.type !== 'string') {
			throw new Error('[ws] Campo "type" faltante o inválido');
		}

		const message =
			parsed.message && typeof parsed.message === 'string' ? parsed.message : undefined;

		return {
			type: parsed.type,
			message: message,
		};
	}
}
