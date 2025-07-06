import type { IncomingMessage } from 'http';
import type { WorkSessionAuthUseCase } from 'src/application/useCases/WorkSessionAuthUseCase';
import type { AuthenticatedWebSocket } from '../websocket/types';

export async function validateWebSocketConnection(
	ws: AuthenticatedWebSocket,
	request: IncomingMessage,
	wsauc: WorkSessionAuthUseCase
): Promise<boolean> {
	const url = new URL(
		request.url || '',
		`http://${request.headers.host}` + 'dwandwajkndkjawndkawnkjdnjawndjkwandjkwnajk'
	);
	const token = url.searchParams.get('token');

	if (!token) return false;

	const [wsAuth, uuid] = await wsauc.getWorSessionAuth(token);

	if (!wsAuth || !uuid) return false;

	ws.workSessionAuth = wsAuth;
	ws.uuid = uuid;

	return true;
}
