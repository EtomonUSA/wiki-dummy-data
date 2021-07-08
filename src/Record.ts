import {
  CompressionFormat,
  EncodeToolsNative as EncodeTools,
  EncodingOptions,
  HashAlgorithm,
  IDFormat,
  ImageFormat,
  SerializationFormat
} from "@etomon/encode-tools/lib/EncodeToolsNative";
import wikipedia from 'wikipedia';
import Page from "wikipedia/dist/page";
import {wikiSummary} from "wikipedia/dist/resultTypes";
import fetch from 'node-fetch';

export interface RecordData {
  id: number;
  title: string;
  url: string;
  description: string;
  extract?: string;
  content?: string;
  coordinates?: {
    longitude: number,
    latitude: number
  },
  blobs?: {
    image?: Buffer;
  }
}

export interface SerializedRecordData {
  text: Buffer;
  blobs: {
    [name: string]: Buffer
  }
}

export type ImageSize = { width: number, height: number }|{ width?: number, height: number }|{ width: number, height?: number };

export interface RecordOptions {
  imageSize: ImageSize,
  encodeOptions: EncodingOptions
}

export interface RecordEnvelope {

}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = {
  encodeOptions: {
    compressionFormat: CompressionFormat.zstd,
    hashAlgorithm: HashAlgorithm.xxhash3,
    serializationFormat: SerializationFormat.msgpack,
    uniqueIdFormat: IDFormat.uuidv4String,
    imageFormat: ImageFormat.jpeg
  },
  imageSize: {
    width: 300
  }
}

export class Record {
  protected encoder = new EncodeTools(this.options.encodeOptions);

  protected _url: string;

  public get url(): string {
    return this._data?.url || this._url;
  }

  constructor(
    urlOrData: string|RecordData,
    public options: RecordOptions = { ...DEFAULT_RECORD_OPTIONS }
  ) {
    if (typeof(urlOrData) === 'string')
      this._url = urlOrData;
    else {
      this._data = urlOrData;
    }
  }

  public get pageId(): string {
    let m = this.url.match(/wikipedia\.org\/wiki\/([^\?]+)\??/gi);
    if (!m) return null;
    return m[0].split('/wiki/').pop().split('?').shift();
  }

  public page?: Page;
  public get hasContent(): boolean { return Boolean(this.data?.content); }
  public get hasSummary(): boolean {
    return Boolean(this._data?.title && this._data?.description);
  }

  public static async recordFromWikiSummary(summary: wikiSummary, {
    loadImage: boolean = true,
    encoder = EncodeTools.WithDefaults,
    imageSize = DEFAULT_RECORD_OPTIONS.imageSize
  }): Promise<RecordData> {
    let data: RecordData = {
      id: summary.pageid,
      url: summary.content_urls.desktop.page,
      title: summary.title,
      extract: summary.extract,
      description: summary.description
    }
    if (summary.coordinates) {
      data.coordinates = { longitude: summary.coordinates.lon, latitude: summary.coordinates.lat };
    }

    let imageUrl = summary.originalimage?.source;
    if (imageUrl) {
      let imageResp: any;
      try {
        imageResp = await fetch(imageUrl);
        let imageBuf = await (imageResp).arrayBuffer();
        data.blobs = {image: await encoder.resizeImage(imageBuf, imageSize)};
      } catch (err) {
        console.warn(err.stack);
      }
    }

    return data;
  }

  async load(loadContent: boolean = false): Promise<void> {
    let page;
    if (!this.hasSummary) {
      page = await wikipedia.page(this.pageId);
      let summary = await page.summary();
      this._data = await Record.recordFromWikiSummary(summary, {
        loadImage: true,
        imageSize: this.options.imageSize,
        encoder: this.encoder
      });
    }

    if (loadContent && !this.hasContent) {
      page = page || await wikipedia.page(this.pageId);
      this._data.content = await page.content();
    }
  }

  protected _data: RecordData|null;

  public get data(): RecordData|null {
    return this._data;
  }

  public async serialize(): Promise<Buffer> {
    return Record.serializeData(this._data, this.encoder);
  }

  public async deserialize(buf: Buffer): Promise<RecordData> {
    this._data = await Record.deserializeData(buf, this.encoder);
    return this._data;
  }

  public static async serializeData(record: RecordData, encoder: EncodeTools = EncodeTools.WithDefaults): Promise<Buffer> {
    let pojo = await Record.preSerializeData(record, encoder);

    return Buffer.from(encoder.serializeObject(pojo));
  }

  public static async deserializeData(buf: Buffer, encoder: EncodeTools = EncodeTools.WithDefaults): Promise<RecordData> {
    let pojo: SerializedRecordData = encoder.deserializeObject(buf);

    return Record.postDeserializeData(pojo, encoder);
  }


  public static async preSerializeData(record: RecordData|Record, encoder: EncodeTools = EncodeTools.WithDefaults): Promise<SerializedRecordData> {
    if (record instanceof Record) {
      if (!record.page)
        await record.load();
      record = record.data;
    }

    let text: any = {
      ...record,
      blobs: null
    };

    delete text.blobs;

    let serializedBuf = Buffer.from(encoder.serializeObject<RecordData>(text, SerializationFormat.json));
    let compressedBuf = await encoder.compress(serializedBuf);

    return {
      text: Buffer.from(compressedBuf),
      blobs: record.blobs
    }
  }

  public static async postDeserializeData(buf: SerializedRecordData, encoder: EncodeTools = EncodeTools.WithDefaults): Promise<RecordData> {
    let decompressedBuf = await encoder.decompress(buf.text, encoder.options.compressionFormat);
    let text = encoder.deserializeObject<RecordData>(decompressedBuf, SerializationFormat.json);
    text.blobs = buf.blobs;
    return text;
  }
}

export default Record;
