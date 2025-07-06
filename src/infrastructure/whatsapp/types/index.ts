export * from './Auth'
export * from './Contact'

export type BrowsersMap = {
    ubuntu(browser: string): [string, string, string]
    macOS(browser: string): [string, string, string]
    baileys(browser: string): [string, string, string]
    windows(browser: string): [string, string, string]
    appropriate(browser: string): [string, string, string]
}

export enum DisconnectReason {
    connectionClosed = 428,
    connectionLost = 408,
    connectionReplaced = 440,
    timedOut = 408,
    loggedOut = 401,
    badSession = 500,
    restartRequired = 515,
    multideviceMismatch = 411,
    forbidden = 403,
    unavailableService = 503
}