export interface FileStorage {
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  getBuffer(key: string): Promise<Buffer>; // útil para zips u otros binarios
}