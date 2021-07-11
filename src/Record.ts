import EncodeToolsNative, {
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
import {imageResult, mediaResult, wikiSummary} from "wikipedia/dist/resultTypes";
import fetch from 'node-fetch';

export interface RecordLoadOptions {
  loadContent?: boolean;
  imagesToLoad?: number;
  // mediaToLoad?: number;
}

export const DEFAULT_RECORD_LOAD_OPTIONS: RecordLoadOptions = {
  imagesToLoad: 1,
  loadContent: false
  // ,mediaToLoad: 0
}

export interface RecordBlob {
  blob: Buffer;
  contentType: string;
  name:string;
}

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
    mainImage?: RecordBlob;
    [name: string]: RecordBlob;
  },
  name?: string;
  start?: number,
  end?: number,
  infobox?: any;
}

export interface SerializedRecordData {
  text: Buffer;
  blobs: {
    mainImage?: RecordBlob;
    [name: string]: RecordBlob;
  }
}

export type ImageSize = { width: number, height: number }|{ width?: number, height: number }|{ width: number, height?: number };

export interface RecordOptions {
  imageSize: ImageSize,
  encodeOptions: EncodingOptions
}

export interface RecordEnvelope {

}

export const DEFAULT_RECORD_ENCODE_OPTIONS: EncodingOptions= {
  compressionFormat: CompressionFormat.lzma,
  hashAlgorithm: HashAlgorithm.xxhash3,
  serializationFormat: SerializationFormat.msgpack,
  uniqueIdFormat: IDFormat.uuidv4String,
  imageFormat: ImageFormat.jpeg
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = {
  encodeOptions: DEFAULT_RECORD_ENCODE_OPTIONS,
  imageSize: {
    width: 300
  }
}

export function defaultEncoder(): EncodeTools {
  return new EncodeToolsNative(
    DEFAULT_RECORD_OPTIONS.encodeOptions
  )
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

  public static async recordFromWikiSummary(summary: wikiSummary, url: string, {
    loadImage: boolean = true,
    encoder = defaultEncoder(),
    imageSize= DEFAULT_RECORD_OPTIONS.imageSize
  }): Promise<RecordData> {
    let data: RecordData = {
      id: summary.pageid,
      url,
      title: summary.title,
      extract: summary.extract,
      description: summary.description
    }
    if (summary.coordinates) {
      data.coordinates = { longitude: summary.coordinates.lon, latitude: summary.coordinates.lat };
    }

    let imageUrl = summary.originalimage?.source;
    // try {
    if (imageUrl) {
      await Record.addMedia({
        _data: data,
        encoder: encoder,
        options: {
          imageSize,
          encodeOptions: encoder.options
        },
      }, imageUrl, 'mainImage');
    }
    // }
    //  catch (err) {
    //   console.warn(err.stack);
    // }

    return data;
  }

  async addMedia(url: string, name: string, contentType?: string): Promise<RecordBlob> {
    return Record.addMedia({
      options: this.options,
      encoder: this.encoder,
      _data: this._data
    }, url, name, contentType);
  }

  static async addMedia(_this: { _data: RecordData, encoder: EncodeTools, options: RecordOptions }, url: string, name: string, contentType?: string): Promise<RecordBlob> {
    const resp = await fetch(url);
    let blob: Buffer = Buffer.from(await (resp).arrayBuffer());
    if (resp.headers.has('content-type') && resp.headers.get('content-type').indexOf('image/') !== -1) {
      contentType = `image/${_this.encoder.options.imageFormat.replace('jpg', 'jpeg').toLowerCase()}`;
      blob = await _this.encoder.resizeImage(blob, _this.options.imageSize);
    }

    const delta = {
      name,
      blob,
      contentType: contentType || resp.headers.get('content-type')
    };

    _this._data.blobs = {
      ...(_this._data.blobs || {}),
      [name]: delta
    }

    return delta;
  }


  public static parseInfobox(infobox: any, summary: any) {
    // Try to get a name
    // For a modern name try splitting the name field or title
    // (e.g., Jovenel Moïse)
    let name: string = (infobox.name || summary.title);
    // For start/end dates look for birthDate and deathDate (people) or start/end (not people)
    let startish = infobox.birthDate?.date || infobox.birthDate || infobox.start?.date || infobox.start;
    let endish = infobox.deathDate?.date || infobox.deathDate || infobox.end?.date || infobox.end;
    let start: number|undefined = startish ? (new Date(startish)).getTime() : void(0);
    let end: number|undefined = endish ? (new Date(endish)).getTime() : void(0);

    return {
      name,
      start,
      end,
      infobox
    }
  }

  async load(loadOptions?: RecordLoadOptions): Promise<RecordData>
  async load(loadContent?: boolean): Promise<RecordData>
  async load(loadOptions: boolean|RecordLoadOptions|undefined = DEFAULT_RECORD_LOAD_OPTIONS): Promise<RecordData> {
    let page: Page;

    if (typeof(loadOptions) === 'boolean') {
      loadOptions = {
        ...DEFAULT_RECORD_LOAD_OPTIONS,
        loadContent: loadOptions
      }
    }

    const loadOpts = loadOptions as RecordLoadOptions;

    if (!this.hasSummary) {
      page = await wikipedia.page(this.pageId);
      let promises: Promise<any>[] = [
        page.summary()
          .then((summary) => {
            return Record.recordFromWikiSummary(summary, page.fullurl,{
              loadImage: Boolean(loadOpts.imagesToLoad),
              imageSize: this.options.imageSize,
              encoder: this.encoder
            })
          }),
        page.infobox({redirect: true })
      ];

      promises.push(loadOpts.imagesToLoad > 1 ? page.images({ limit: loadOpts.imagesToLoad - 1, redirect: true }) : Promise.resolve(null));

      // if (loadOpts.mediaToLoad > 0) {
      //   promises.push(page.media({redirect: true}));
      // }

      if (loadOpts.loadContent) {
        promises.push(page.content().then((r) =>  (!r) ? page.intro() : r));
      }

      let [
        summaryData,
        infobox,
        images,
        // ,media
        content
      ] = await Promise.all(promises);

      if (images) {
        let theImages = [].concat((images as imageResult[]));
        for (const image of theImages) {
          if (!image.url)
            continue;
          await this.addMedia(image.url, image.ns+'');
        }
      }

      // if (media) {
      //   for (const article of (media as mediaResult[])) {
      //     article.
      //     await this.addMedia(image.url, image.pageid+'');
      //   }
      // }

      this._data = {
        ...summaryData,
        content,
        ...(Record.parseInfobox(infobox, summaryData))
      };
    }

     return this._data;
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

  public static async serializeData(record: RecordData, encoder: EncodeTools = defaultEncoder()): Promise<Buffer> {
    let pojo = await Record.preSerializeData(record, encoder);

    return Buffer.from(encoder.serializeObject(pojo));
  }

  public static async deserializeData(buf: Buffer, encoder: EncodeTools = defaultEncoder()): Promise<RecordData> {
    let pojo: SerializedRecordData = encoder.deserializeObject(buf);

    return Record.postDeserializeData(pojo, encoder);
  }


  public static async preSerializeData(record: RecordData|Record, encoder: EncodeTools = defaultEncoder()): Promise<SerializedRecordData> {
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

  public static async postDeserializeData(buf: SerializedRecordData, encoder: EncodeTools = defaultEncoder()): Promise<RecordData> {
    let decompressedBuf = await encoder.decompress(buf.text, encoder.options.compressionFormat);
    let text = encoder.deserializeObject<RecordData>(decompressedBuf, SerializationFormat.json);
    text.blobs = buf.blobs;
    return text;
  }
}

export default Record;
