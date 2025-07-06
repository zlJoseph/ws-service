
//reemplazado por el logger de aplicación
export interface ILogger {
	child(obj: Record<string, unknown>): ILogger
}
