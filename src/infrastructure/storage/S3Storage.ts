import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import type { FileStorage } from 'src/application/ports';
import type { Readable } from 'stream';

export class S3Storage implements FileStorage {
	private isLocal = process.env.ENV === 'local';
	private s3: S3Client;
	private bucket: string;

	constructor(bucket: string) {
		this.s3 = new S3Client({
			region: process.env.AWS_REGION || 'us-east-1',
			credentials: this.isLocal ? fromIni({ profile: 'dev' }) : undefined,
		});
		this.bucket = bucket;
	}

	async getStream(key: string): Promise<Readable> {
		const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
		const response = await this.s3.send(command);
		return response.Body as Readable;
	}

	async getBuffer(key: string): Promise<Buffer> {
		const stream = await this.getStream(key);
		const chunks: Buffer[] = [];
		for await (const chunk of stream) {
			chunks.push(chunk as Buffer);
		}
		return Buffer.concat(chunks);
	}
}
