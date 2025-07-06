export interface Logger {
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  trace(message: string, data?: unknown): void
  error(message: string, error?: unknown): void
}