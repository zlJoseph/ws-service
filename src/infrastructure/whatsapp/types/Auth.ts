import { ADVSignedDeviceIdentity, Message_AppStateSyncKeyData } from "../proto"
import { Contact } from "./Contact"

export type KeyPair = { public: Uint8Array, private: Uint8Array }

export type SignedKeyPair = {
    keyPair: KeyPair
    signature: Uint8Array
    keyId: number
    timestampS?: number
}

export type SignalCreds = {
    readonly signedIdentityKey: KeyPair
    readonly signedPreKey: SignedKeyPair
    readonly registrationId: number
}

export type ProtocolAddress = {
	name: string // jid
	deviceId: number
}

export type SignalIdentity = {
	identifier: ProtocolAddress
	identifierKey: Uint8Array
}

export type AuthenticationCreds = SignalCreds & {
    readonly noiseKey: KeyPair
    readonly pairingEphemeralKeyPair: KeyPair
    advSecretKey: string
    me?: Contact
    account?: ADVSignedDeviceIdentity
    signalIdentities?: SignalIdentity[]
    myAppStateKeyId?: string
    firstUnuploadedPreKeyId: number
    nextPreKeyId: number
    lastAccountSyncTimestamp?: number
    platform?: string
    /** number of times history & app state has been synced */
    accountSyncCounter: number
    registered: boolean
    pairingCode: string | undefined
    lastPropHash: string | undefined
    routingInfo: Buffer | undefined
}

export type LTHashState = {
    version: number
    hash: Buffer
    indexValueMap: {
        [indexMacBase64: string]: { valueMac: Uint8Array | Buffer }
    }
}

export type SignalDataTypeMap = {
    'pre-key': KeyPair
    'session': Uint8Array
    'sender-key': Uint8Array
    'sender-key-memory': { [jid: string]: boolean }
    'app-state-sync-key': Message_AppStateSyncKeyData
    'app-state-sync-version': LTHashState
}

type Awaitable<T> = T | Promise<T>

export type SignalDataSet = { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] | null } }

export type SignalKeyStore = {
    get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Awaitable<{ [id: string]: SignalDataTypeMap[T] }>
    set(data: SignalDataSet): Awaitable<void>
    /** clear all the data in the store */
    clear?(): Awaitable<void>
}

export type AuthenticationState = {
    creds: AuthenticationCreds
    keys: SignalKeyStore
}

export type SignalKeyStoreWithTransaction = SignalKeyStore & {
    isInTransaction: () => boolean
    transaction<T>(exec: () => Promise<T>): Promise<T>
}

export type SignalAuthState = {
    creds: SignalCreds
    keys: SignalKeyStore | SignalKeyStoreWithTransaction
}

export type TransactionCapabilityOptions = {
	maxCommitRetries: number
	delayBetweenTriesMs: number
}