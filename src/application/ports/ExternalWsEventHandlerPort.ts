export interface ExternalWsEventHandlerPort {
	sendNotificationClient(session: string, payload: any): void;
}
