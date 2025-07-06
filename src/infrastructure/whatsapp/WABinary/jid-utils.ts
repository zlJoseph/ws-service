export type JidServer = 'c.us' | 'g.us' | 'broadcast' | 's.whatsapp.net' | 'call' | 'lid' | 'newsletter'

export type JidWithDevice = {
    user: string
    device?: number
}

export type FullJid = JidWithDevice & {
	server: JidServer
	domainType?: number
}

export const jidEncode = (user: string | number | null, server: JidServer, device?: number, agent?: number) => {
	return `${user || ''}${!!agent ? `_${agent}` : ''}${!!device ? `:${device}` : ''}@${server}`
}

export const jidDecode = (jid: string | undefined): FullJid | undefined => {
	const sepIdx = typeof jid === 'string' ? jid.indexOf('@') : -1
	if(sepIdx < 0) {
		return undefined
	}

	const server = jid!.slice(sepIdx + 1)
	const userCombined = jid!.slice(0, sepIdx)

	const [userAgent, device] = userCombined.split(':')
	const user = userAgent.split('_')[0]

	return {
		server: server as JidServer,
		user,
		domainType: server === 'lid' ? 1 : 0,
		device: device ? +device : undefined
	}
}

/** is the jid a user */
export const areJidsSameUser = (jid1: string | undefined, jid2: string | undefined) => (
	jidDecode(jid1)?.user === jidDecode(jid2)?.user
)
/** is the jid a user */
export const isJidUser = (jid: string | undefined) => (jid?.endsWith('@s.whatsapp.net'))
/** is the jid a broadcast */
export const isJidBroadcast = (jid: string | undefined) => (jid?.endsWith('@broadcast'))
/** is the jid the status broadcast */
export const isJidStatusBroadcast = (jid: string) => jid === 'status@broadcast'

export const jidNormalizedUser = (jid: string | undefined) => {
	const result = jidDecode(jid)
	if(!result) {
		return ''
	}

	const { user, server } = result
	return jidEncode(user, server === 'c.us' ? 's.whatsapp.net' : server as JidServer)
}
