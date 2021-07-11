import {default as Record, RecordLoadOptions, RecordOptions, SerializedRecordData} from './Record';
import {NavboxParser, NavboxParserOptions} from '@etomon/wiki-navbox-parser';
import {EncodeToolsNative} from "@etomon/encode-tools";
import * as _ from 'lodash';
export class WikiDummyDataCreator {
  constructor(public recordOptions?: RecordOptions, protected navboxOptions?: NavboxParserOptions, protected asyncCrawl: boolean = false) {

  }

  async serializeCollection(collection: Record[]): Promise<Buffer[]> {
    return Promise.all(
      collection.map((r) => {
        return r.serialize();
      })
    );
  }

  async deserializeCollection(collection: Buffer[]): Promise<Record[]> {
    return Promise.all(
      collection.map(async (r) => {
        let data = await Record.deserializeData(r, new EncodeToolsNative(this.recordOptions?.encodeOptions))
        return new Record(data, this.recordOptions);
      })
    );
  }

  async* createCollection(collectionUrl: string, collectionName: string, loadOptions: RecordLoadOptions): AsyncGenerator<Record> {
    const nav = await NavboxParser.fromUrl(collectionUrl, this.navboxOptions);
    const cols = nav.getCollections();
    let col = cols.get(collectionName);
    if (!col)
      return null;

    let items: string[] = [];
    for (let list of col.lists) {
      for (let item of list.listItems) {
        for (let link of item.links) {
          items.push(link.url);
        }
      }
    }

    items = _.uniq(items);

    let fn: any = async (str: string) => {
      try {
        let record = new Record(str, this.recordOptions);
        await record.load(loadOptions);

        return record;
      } catch (err) {
        console.warn(err.stack);
        return null;
      }
    }

    for (let item of items) {
      let res = await fn(item);
      if (!res) continue;
      yield res;
    }
  }
}
export default WikiDummyDataCreator;
