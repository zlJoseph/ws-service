import { WSAuth } from "src/domain";
import { UserReceipt } from "../proto";
import { AuthenticationCreds } from "./Auth";
import { MessageUpsertType, WAMessage, WAMessageKey, WAMessageUpdate } from "./Message";
import { ConnectionState } from "./State";

export type ConnectionStateSession = {
	session: WSAuth,
	update: Partial<ConnectionState>
}

export type BaileysEventMap = {
	/** connection state has been updated -- WS closed, opened, connecting etc. */
	'connection.update': ConnectionStateSession
	/** credentials updated -- some metadata, keys or something */
	'creds.update': Partial<AuthenticationCreds>
    /** print qr to client */
    'print.qr': {session: string, payload: { qr: string}}
	/**
	 * add/update the given messages. If they were received while the connection was online,
	 * the update will have type: "notify"
	 * if requestId is provided, then the messages was received from the phone due to it being unavailable
	 *  */
	'messages.upsert': { messages: WAMessage[]; type: MessageUpsertType; requestId?: string }
}

export interface BaileysEventEmitter {
	on<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void
	off<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void
	removeAllListeners<T extends keyof BaileysEventMap>(event: T): void
	emit<T extends keyof BaileysEventMap>(event: T, arg: BaileysEventMap[T]): boolean
}

export type BufferedEventData = {
	messageUpserts: { [key: string]: { type: MessageUpsertType; message: WAMessage } }
	messageUpdates: { [key: string]: WAMessageUpdate }
	messageReceipts: { [key: string]: { key: WAMessageKey; userReceipt: UserReceipt[] } }
}

export type BaileysEvent = keyof BaileysEventMap