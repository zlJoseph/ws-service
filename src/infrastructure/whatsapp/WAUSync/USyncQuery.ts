import { USyncQueryProtocol } from "../types/USync";
import { BinaryNode } from "../WABinary";
import { getBinaryNodeChild } from "../WABinary/genericUtils";
import { USyncDeviceProtocol } from "./Protocols";
import { USyncUser } from "./USyncUser";

export type USyncQueryResultList = { [protocol: string]: unknown; id: string }

export type USyncQueryResult = {
	list: USyncQueryResultList[]
	sideList: USyncQueryResultList[]
}

export class USyncQuery {
	protocols: USyncQueryProtocol[]
	users: USyncUser[]
	context: string
	mode: string

	constructor() {
		this.protocols = []
		this.users = []
		this.context = 'interactive'
		this.mode = 'query'
	}

	withContext(context: string) {
		this.context = context
		return this
	}

	withUser(user: USyncUser) {
		this.users.push(user)
		return this
	}
	
	parseUSyncQueryResult(result: BinaryNode): USyncQueryResult | undefined {
		if (result.attrs.type !== 'result') {
			return
		}

		const protocolMap = Object.fromEntries(
			this.protocols.map(protocol => {
				return [protocol.name, protocol.parser]
			})
		)

		const queryResult: USyncQueryResult = {
			// TODO: implement errors etc.
			list: [],
			sideList: []
		}

		const usyncNode = getBinaryNodeChild(result, 'usync')

		//TODO: implement error backoff, refresh etc.
		//TODO: see if there are any errors in the result node
		//const resultNode = getBinaryNodeChild(usyncNode, 'result')

		const listNode = getBinaryNodeChild(usyncNode, 'list')
		if (Array.isArray(listNode?.content) && typeof listNode !== 'undefined') {
			queryResult.list = listNode.content.map(node => {
				const id = node?.attrs.jid
				const data = Array.isArray(node?.content)
					? Object.fromEntries(
							node.content
								.map(content => {
									const protocol = content.tag
									const parser = protocolMap[protocol]
									if (parser) {
										return [protocol, parser(content)]
									} else {
										return [protocol, null]
									}
								})
								.filter(([, b]) => b !== null) as [string, unknown][]
						)
					: {}
				return { ...data, id }
			})
		}

		//TODO: implement side list
		//const sideListNode = getBinaryNodeChild(usyncNode, 'side_list')
		return queryResult
	}

	withDeviceProtocol() {
		this.protocols.push(new USyncDeviceProtocol())
		return this
	}
}