import EventEmitter from "events"
import { BaileysEventEmitter, BaileysEventMap, BufferedEventData, BaileysEvent } from "../types/Events"
import { MessageKey } from "../proto"
import { Logger } from "src/application/ports/output"

const BUFFERABLE_EVENT = [
	'messages.upsert',
	'messages.update',
	'message-receipt.update',
] as const

type BufferableEvent = (typeof BUFFERABLE_EVENT)[number]

type BaileysEventData = Partial<BaileysEventMap>

const BUFFERABLE_EVENT_SET = new Set<BaileysEvent>(BUFFERABLE_EVENT as readonly (keyof BaileysEventMap)[])

export type BaileysBufferableEventEmitter = BaileysEventEmitter & {
	/** Use to process events in a batch */
	process(handler: (events: BaileysEventData) => void | Promise<void>): () => void
	/**
	 * starts buffering events, call flush() to release them
	 * */
	buffer(): void
	/** buffers all events till the promise completes */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createBufferedFunction<A extends any[], T>(work: (...args: A) => Promise<T>): (...args: A) => Promise<T>
	/**
	 * flushes all buffered events
	 * @param force if true, will flush all data regardless of any pending buffers
	 * @returns returns true if the flush actually happened, otherwise false
	 */
	flush(force?: boolean): boolean
	/** is there an ongoing buffer */
	isBuffering(): boolean
}

/**
 * The event buffer logically consolidates different events into a single event
 * making the data processing more efficient.
 * @param ev the baileys event emitter
 */
export const makeEventBuffer = (logger: Logger): BaileysBufferableEventEmitter => {
	const ev = new EventEmitter()
	const historyCache = new Set<string>()

	let data = makeBufferData()
	let buffersInProgress = 0

	// take the generic event and fire it as a baileys event
	ev.on('event', (map: BaileysEventData) => {
		for (const event in map) {
			ev.emit(event, map[event as keyof BaileysEventData])
		}
	})

	function buffer() {
		buffersInProgress += 1
	}

	function flush(force = false) {
		// no buffer going on
		if (!buffersInProgress) {
			return false
		}

		if (!force) {
			// reduce the number of buffers in progress
			buffersInProgress -= 1
			// if there are still some buffers going on
			// then we don't flush now
			if (buffersInProgress) {
				return false
			}
		}

		/*const newData = makeBufferData()
		const chatUpdates = Object.values(data.chatUpdates)
		
		// gather the remaining conditional events so we re-queue them
		let conditionalChatUpdatesLeft = 0
		for (const update of chatUpdates) {
			if (update.conditional) {
				conditionalChatUpdatesLeft += 1
				newData.chatUpdates[update.id!] = update
				delete data.chatUpdates[update.id!]
			}
		}

		const consolidatedData = consolidateEvents(data)
		if (Object.keys(consolidatedData).length) {
			ev.emit('event', consolidatedData)
		}

		data = newData

		logger.trace({ conditionalChatUpdatesLeft }, 'released buffered events')*/

		return true
	}

	return {
		process(handler) {
			const listener = (map: BaileysEventData) => {
				handler(map)
			}

			ev.on('event', listener)
			return () => {
				ev.off('event', listener)
			}
		},
		emit<T extends BaileysEvent>(event: BaileysEvent, evData: BaileysEventMap[T]) {
			if (buffersInProgress && BUFFERABLE_EVENT_SET.has(event)) {
				append(data, historyCache, event as BufferableEvent, evData, logger)
				return true
			}

			return ev.emit('event', { [event]: evData })
		},
		isBuffering() {
			return buffersInProgress > 0
		},
		buffer,
		flush,
		createBufferedFunction(work) {
			return async (...args) => {
				buffer()
				try {
					const result = await work(...args)
					return result
				} finally {
					flush()
				}
			}
		},
		on: (...args) => ev.on(...args),
		off: (...args) => ev.off(...args),
		removeAllListeners: (...args) => ev.removeAllListeners(...args)
	}
}

const makeBufferData = (): BufferedEventData => {
	return {
		messageUpserts: {},
		messageUpdates: {},
		messageReceipts: {}
	}
}

function append<E extends BufferableEvent>(
	data: BufferedEventData,
	historyCache: Set<string>,
	event: E,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	eventData: any,
	logger: Logger
) {
	switch (event) {
		case 'messages.upsert':
			const { messages, type } = eventData as BaileysEventMap['messages.upsert']
			for (const message of messages) {
				const key = stringifyMessageKey(message?.key!)
				let existing = data.messageUpserts[key]?.message
				if (!existing) {
					/*existing = data.historySets.messages[key]
					if (existing) {
						logger.debug({ messageId: key }, 'absorbed message upsert in message set')
					}*/
				}

				if (existing) {
					message.messageTimestamp = existing.messageTimestamp
				}

				if (data.messageUpdates[key]) {
					//logger.debug('absorbed prior message update in message upsert')
					Object.assign(message, data.messageUpdates[key].update)
					delete data.messageUpdates[key]
				}

				if (/*data.historySets.messages[key]*/false) {
					//data.historySets.messages[key] = message
				} else {
					data.messageUpserts[key] = {
						message,
						type: type === 'notify' || data.messageUpserts[key]?.type === 'notify' ? 'notify' : type
					}
				}
			}

			break
		case 'messages.update':
			/*const msgUpdates = eventData as BaileysEventMap['messages.update']
			for (const { key, update } of msgUpdates) {
				const keyStr = stringifyMessageKey(key)
				const existing = data.historySets.messages[keyStr] || data.messageUpserts[keyStr]?.message
				if (existing) {
					Object.assign(existing, update)
					// if the message was received & read by us
					// the chat counter must have been incremented
					// so we need to decrement it
					if (update.status === WAMessageStatus.READ && !key.fromMe) {
						decrementChatReadCounterIfMsgDidUnread(existing)
					}
				} else {
					const msgUpdate = data.messageUpdates[keyStr] || { key, update: {} }
					Object.assign(msgUpdate.update, update)
					data.messageUpdates[keyStr] = msgUpdate
				}
			}*/

			break
		default:
			throw new Error(`"${event}" cannot be buffered`)
	}
}

const stringifyMessageKey = (key: MessageKey) => `${key.remoteJid},${key.id},${key.fromMe ? '1' : '0'}`