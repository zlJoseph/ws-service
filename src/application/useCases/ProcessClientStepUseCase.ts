import type { WorkSessionAuth } from 'src/domain/entities';
import type { IncomingMessage } from 'src/domain/valueObjects';
import type {
	Cache,
	ClientWsPort,
	ExternalWsEventHandlerPort,
	FileStorage,
	Logger,
	WhatsAppSessionsWSPort,
} from '../ports';
import { parse } from 'fast-csv';
import unzipper from 'unzipper';

interface SendMessageBot {
	message: string;
	numero: string;
	withImage: boolean;
	image: Buffer<ArrayBufferLike> | null;
}

export class ProcessClientStepUseCase implements ExternalWsEventHandlerPort {
	constructor(
		private logger: Logger,
		private externalWs: WhatsAppSessionsWSPort,
		private clientWs: ClientWsPort,
		private storage: FileStorage,
		private cacheRepo: Cache
	) {
		this.externalWs.setEventHandler(this);
	}

	async connect(wsAuth: WorkSessionAuth): Promise<void> {
		await this.externalWs.connect(wsAuth);
	}

	async sendMessage(uuid: string, wsAuth: WorkSessionAuth, event: IncomingMessage) {
		this.clientWs.sendToClient(wsAuth.Token, { type: 'progress', current: 0, total: '-' });
		const withImage = !!wsAuth.UploadedZipUrl;
		let imageMap: Map<string, Buffer<ArrayBufferLike>> = new Map<string, Buffer>();
		if (withImage) {
			const keyZip = decodeURIComponent(new URL(wsAuth.UploadedZipUrl).pathname.slice(1));
			const zipBuffer = await this.storage.getBuffer(keyZip);
			imageMap = await this.extractImagesFromZip(zipBuffer);
		}
		const keyCSV = decodeURIComponent(new URL(wsAuth.UploadedCSVUrl).pathname.slice(1));
		const streamCSV = await this.storage.getStream(keyCSV);

		const streamCSVCount = await this.storage.getStream(keyCSV);
		const totalRows = await this.countRowsFromStream(streamCSVCount);

		this.clientWs.sendToClient(wsAuth.Token, {
			type: 'progress',
			current: 0,
			total: totalRows,
		});

		const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

		const payloadMessages = await this.extractDataFromCSV(streamCSV, event.message ?? '');

		let current = 0;
		for (const payloadMessage of payloadMessages) {
			if (withImage) {
				const imageBuffer = imageMap.get(payloadMessage.numero + '.jpg') ?? imageMap.get('all.jpg');
				if (imageBuffer) {
					payloadMessage.image = imageBuffer;
				}
			}
			await this.externalWs.sendMessage(wsAuth, payloadMessage);
			current++;
			this.clientWs.sendToClient(wsAuth.Token, {
				type: 'progress',
				current,
				total: totalRows,
			});

			await sleep(100);
		}

		await this.cacheRepo.del('ws-token-lookup:' + wsAuth.Token);
		await this.cacheRepo.del('wslogin:' + uuid);
		await this.externalWs.logout(wsAuth);
	}

	sendNotificationClient(session: string, payload: any) {
		this.clientWs.sendToClient(session, payload);
	}

	async disconnect(wsAuth: WorkSessionAuth) {
		await this.externalWs.disconnect(wsAuth);
	}

	async disconnectAll() {
		await this.externalWs.disconnectAll();
	}

	async countRowsFromStream(readable: NodeJS.ReadableStream): Promise<number> {
		let count = 0;
		return new Promise((resolve, reject) => {
			readable
				.pipe(parse({ headers: true }))
				.on('data', () => count++)
				.on('end', () => resolve(count))
				.on('error', reject);
		});
	}

	async extractDataFromCSV(
		csv: NodeJS.ReadableStream,
		template: string
	): Promise<SendMessageBot[]> {
		const payloadMessages: SendMessageBot[] = [];
		return new Promise((resolve, reject) => {
			csv
				.pipe(parse({ headers: true }))
				.on('data', (row: Record<string, string>) => {
					const messageTemplate = template;
					const message = messageTemplate.replace(/\$(\w+)/g, (_, key: string) => row[key] || '');
					const payloadSendMessage: SendMessageBot = {
						message,
						numero: row.Numero,
						withImage: false,
						image: null,
					};

					payloadMessages.push(payloadSendMessage);
				})
				.on('end', () => resolve(payloadMessages))
				.on('error', reject);
		});
	}

	async extractImagesFromZip(zipBuffer: Buffer): Promise<Map<string, Buffer>> {
		const imageMap = new Map<string, Buffer>();
		const zip = await unzipper.Open.buffer(zipBuffer);

		for (const file of zip.files) {
			if (!file.path.endsWith('.jpg')) continue;

			const chunks: Uint8Array[] = [];
			const stream = file.stream();
			for await (const chunk of stream) chunks.push(chunk as Uint8Array);

			imageMap.set(file.path, Buffer.concat(chunks));
		}

		return imageMap;
	}
}
