import type { WebSocket } from 'ws';
import type { WorkSessionAuth } from '../../domain/entities/WorkSessionAuth';

export interface AuthenticatedWebSocket extends WebSocket {
	workSessionAuth: WorkSessionAuth;
	uuid: string;
}
