import { join } from "path";
import { BufferJSON, initAuthCreds } from "src/infrastructure/whatsapp/utils";
import type { AuthenticationCreds, AuthenticationState, SignalDataSet, SignalDataTypeMap } from "src/infrastructure/whatsapp/types";
import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { Mutex } from 'async-mutex'
import { Message_AppStateSyncKeyData } from "src/infrastructure/whatsapp/proto";
import type { Logger } from "src/application/ports";

export class MultiFileAuthStore {
    private creds: AuthenticationCreds = {} as AuthenticationCreds;
    private folder: string;
    private fileLocks = new Map<string, Mutex>()

    constructor(private logger: Logger, userId: string) {
        this.folder = join('./auth', userId); // cada user en su carpeta
    }

    async init(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
        await this.ensureFolderExists();
        this.creds = (await this.readData('creds.json')) || initAuthCreds();
        return {
            state: {
                creds: this.creds,
                keys: {
                    get: this.getKeys.bind(this),
                    set: this.setKeys.bind(this),
                },
            },
            saveCreds: this.saveCreds.bind(this)
        }; 
    }

    private async ensureFolderExists(): Promise<void> {
        try {
            const folderInfo = await stat(this.folder);
            if (!folderInfo.isDirectory()) {
                throw new Error(`Path ${this.folder} exists and is not a directory`);
            }
        } catch (err) {
            if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
                await mkdir(this.folder, { recursive: true });
            } else {
                throw err;
            }
        }
    }

    async readData<T>(file: string): Promise<T | null> {
		try {
			const filePath = join(this.folder, this.fixFileName(file)!)
			const mutex = this.getFileLock(filePath)

			return await mutex.acquire().then(async (release: () => void) => {
				try {
					const data = await readFile(filePath, { encoding: 'utf-8' })
					return JSON.parse(data, BufferJSON.reviver) as T
				} finally {
					release()
				}
			})
		} catch (err) {
            this.logger.error('Error al leer la data', err)
			return null
		}
	}

    fixFileName(file?: string){ 
        return file?.replace(/\//g, '__')?.replace(/:/g, '-')
    }

    getFileLock(path: string): Mutex{
        let mutex = this.fileLocks.get(path)
        if (!mutex) {
            mutex = new Mutex()
            this.fileLocks.set(path, mutex)
        }

        return mutex
    }

    async writeData(data: any, file: string) {
		const filePath = join(this.folder, this.fixFileName(file)!)
		const mutex = this.getFileLock(filePath)

		return mutex.acquire().then(async release => {
			try {
				await writeFile(filePath, JSON.stringify(data, BufferJSON.replacer))
			} finally {
				release()
			}
		})
	}

    async saveCreds(): Promise<void> {
        await this.writeData(this.creds, 'creds.json');
    }

    async getKeys<K extends keyof SignalDataTypeMap>(type: K, ids: string[]){
        const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
		await Promise.all(
			ids.map(async id => {
				let value = await this.readData<SignalDataTypeMap[K]>(`${type}-${id}.json`)
				if (type === 'app-state-sync-key' && value) {
					value = Message_AppStateSyncKeyData.fromJSON(value) as SignalDataTypeMap[K]
				}
				data[id] = value!
			})
		)

		return data
    }

    async setKeys(data: SignalDataSet){
        const tasks: Promise<void>[] = []
		for (const category in data) {
			for (const id in data[category as keyof SignalDataSet]) {
				const value = data[category as keyof SignalDataSet]![id]
				const file = `${category}-${id}.json`
				tasks.push(value ? this.writeData(value, file) : this.removeData(file))
			}
		}

		await Promise.all(tasks)
    }

    async removeData(file: string){
		try {
			const filePath = join(this.folder, this.fixFileName(file)!)
			const mutex = this.getFileLock(filePath)

			return mutex.acquire().then(async release => {
				try {
					await unlink(filePath)
				} catch(err) {
                    this.logger.error('Error al eliminar el archivo', err)
				} finally {
					release()
				}
			})
		} catch(err) {
            this.logger.error('Error genérica al remover', err)
        }
	}
}