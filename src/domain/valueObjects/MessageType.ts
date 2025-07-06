export class MessageType {
	private static readonly VALID_TYPES = ['CONNECT', 'PROCESS'] as const;

	public static readonly CONNECT = new MessageType('CONNECT');
	public static readonly PROCESS = new MessageType('PROCESS');

	private constructor(private readonly value: string) {}

	public static from(value: string): MessageType {
		if (!this.VALID_TYPES.includes(value as (typeof this.VALID_TYPES)[number])) {
			throw new Error(`Tipo de mensaje: ${value}`);
		}

		switch (value) {
			case 'CONNECT':
				return this.CONNECT;
			case 'PROCESS':
				return this.PROCESS;
		}

		throw new Error(`Error en manejar el tipo de mensaje: ${value}`);
	}

	public equals(other: MessageType): boolean {
		return this.value === other.value;
	}

	public toString(): string {
		return this.value;
	}

	public isConnect(): boolean {
		return this.value === 'CONNECT';
	}

	public isProcess(): boolean {
		return this.value === 'PROCESS';
	}
}
