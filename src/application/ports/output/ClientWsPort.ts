export interface ClientWsPort {
	//Comunicación de la aplicación con el cliente
	sendToClient(sessionId: string, payload: any): void;
}
