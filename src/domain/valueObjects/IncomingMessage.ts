import { MessageType } from './MessageType';

export class IncomingMessage {
	constructor(
		public readonly type: MessageType,
		public readonly message?: string
	) {}

	static fromObject(obj: { type: string; message?: string }): IncomingMessage {
		const type = MessageType.from(obj.type);
		return new IncomingMessage(type, obj.message);
	}

	isConnect(): boolean {
		return this.type.isConnect();
	}

	isProcess(): boolean {
		return this.type.isProcess();
	}
}
