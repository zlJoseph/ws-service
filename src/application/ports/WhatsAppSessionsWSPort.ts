import { WorkSessionAuth } from "src/domain/entities";
import { ExternalWsEventHandlerPort } from "./ExternalWsEventHandlerPort";

export interface WhatsAppSessionsWSPort {
  setEventHandler(handler: ExternalWsEventHandlerPort): void;
  connect(wsAuth: WorkSessionAuth): Promise<void>;
  sendMessage(wsAuth: WorkSessionAuth, payload: any): Promise<void>;
  logout(wsAuth: WorkSessionAuth): Promise<void>;
  disconnect(wsAuth: WorkSessionAuth): Promise<void>;
  disconnectAll(): Promise<void>;
}