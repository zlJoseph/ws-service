import type { Server } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { createClient } from 'redis';
import type { AuthenticatedWebSocket } from 'src/interfaces/websocket';
import { WebSocketHandler } from 'src/interfaces/websocket';
import { WhatsAppSessionsWS } from 'src/infrastructure/whatsapp';
import { ProcessClientStepUseCase, WorkSessionAuthUseCase } from 'src/application/useCases';
import { initRedisClient } from 'src/infrastructure/cache';
import { CacheRepositoryRedis } from 'src/infrastructure/repositories';
import { validateWebSocketConnection } from 'src/interfaces/middleware';
import { S3Storage } from 'src/infrastructure/storage';
import { PinoLogger } from 'src/infrastructure/logger';

const logger = new PinoLogger();
let redisClient: ReturnType<typeof createClient>;
const clients = new Set<WebSocket>();
let wsHandler: WebSocketHandler;
let wss: Server<typeof WebSocket, typeof IncomingMessage>;

async function bootstrap() {
	redisClient = await initRedisClient(logger);
	const redisCache = new CacheRepositoryRedis(redisClient);
	const s3storage = new S3Storage('whatbot-prd');

	const externalWsClient = new WhatsAppSessionsWS(logger);
	wsHandler = new WebSocketHandler(logger);
	const processClientStepUseCase = new ProcessClientStepUseCase(
		logger,
		externalWsClient,
		wsHandler,
		s3storage,
		redisCache
	);
	wsHandler.setProcessEvent(processClientStepUseCase);
	const workSessionAuthUseCase = new WorkSessionAuthUseCase(redisCache);

	// 2. Setup WebSocket server
	const port = parseInt(process.env.PORT ?? '8081', 10);
	wss = new WebSocketServer({ port });

	// 4. Escuchar nuevas conexiones WebSocket entrantes
	wss.on('connection', (wsRaw, request) => {
		void (async () => {
			const ws = wsRaw as AuthenticatedWebSocket;
			const isValid = await validateWebSocketConnection(ws, request, workSessionAuthUseCase);

			if (!isValid) {
				logger.warn('Token inválido', request);
				ws.close(1008, 'Token inválido');
				return;
			}

			clients.add(ws);
			wsHandler.handleConnection(ws);

			ws.on('close', () => {
				clients.delete(ws);
			});
		});
	});

	wss.on('listening', () => {
		logger.info(`[ws-server] WebSocket server listening on port ${port}`);
	});
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('uncaughtException', err => {
	logger.error('Excepción no capturada:', err);
	shutdown();
});

function shutdown() {
	void (async () => {
		if (redisClient && redisClient.isOpen) {
			await redisClient.quit();
		}

		clients.forEach(client => {
			if (client.readyState === WebSocket.OPEN) {
				client.close(1001, 'Servidor apagado');
			}
		});

		if (wsHandler) await wsHandler.shutdown();

		if (wss) {
			wss.close(() => {
				logger.info('Servidor WebSocket cerrado.');
			});
		}

		process.exit(0);
	});
}

bootstrap().catch(err => {
	logger.error('Error al inciar el servidor', err);
});
