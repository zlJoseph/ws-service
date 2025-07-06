import { MultiFileAuthStore } from '../auth/MultiFileAuthStore';
import { DEFAULT_CONNECTION_CONFIG } from './Defaults';
import { ServiceSocketClient } from './sockets/ServiceSocketClient';
import { SocketConfig } from './types/Socket';
import { makeCacheableSignalKeyStore } from './utils';
import { WorkSessionAuth } from 'src/domain/entities';
import { Logger } from 'src/application/ports/output';

export class WhatsAppWSClient {
	public socket!: ServiceSocketClient;
	private saveCredentialWP!: () => Promise<void>;

	constructor(
		private logger: Logger,
		private wsAuth: WorkSessionAuth,
		private number: number
	) {}

	async init() {
		const multiFileAuthStore = new MultiFileAuthStore(this.logger, this.wsAuth.Token);

		const { state, saveCreds } = await multiFileAuthStore.init();
		this.saveCredentialWP = saveCreds;

		const AUTH_CONFIG: SocketConfig = {
			...DEFAULT_CONNECTION_CONFIG,
			workSession: this.wsAuth,
			logger: this.logger,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, this.logger),
			},
		};

		this.socket = new ServiceSocketClient(AUTH_CONFIG, this.number);

		this.socket.ev.on('creds.update', this.handleCredsUpdate.bind(this));

		await this.socket.startConnection();
	}

	async logout() {
		await this.socket.logout();
	}

	async close() {
		console.log('Cerrando conexión desde el cliente');
		await this.socket.endAll(undefined);
	}

	async handleCredsUpdate() {
		await this.saveCredentialWP();
	}

	async handleSendMessage(payload: {
		message: string;
		numero: string;
		withImage: boolean;
		image: Buffer<ArrayBufferLike> | null;
	}) {
		await this.socket.handleSendMessageToNumber(payload);
	}
}
