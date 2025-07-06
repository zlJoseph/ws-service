import pino from 'pino';
import type { Logger } from 'src/application/ports/output';

const pinoLogger = pino({
	level: process.env.LOG_LEVEL || 'info',
	formatters: {
		level: label => ({ level: label.toUpperCase() }),
	},
	timestamp: pino.stdTimeFunctions.isoTime,
});

export class PinoLogger implements Logger {
	info(message: string, data?: unknown) {
		pinoLogger.info(data ?? {}, message);
	}

	warn(message: string, data?: unknown) {
		pinoLogger.warn(data ?? {}, message);
	}

	trace(message: string, data?: unknown) {
		pinoLogger.trace(data ?? {}, message);
	}

	error(message: string, err?: unknown) {
		pinoLogger.error({ err }, message);
	}
}
