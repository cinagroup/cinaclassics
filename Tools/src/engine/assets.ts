// 素材加载层：本地 Node（文件系统）与 Workers（R2）共用同一接口
// R2 key 布局与仓库目录一致：fonts/ canvas/ books/ db/

export interface AssetSource {
  /** 文本文件（utf8 解码后返回），不存在返回 null */
  readText(key: string): Promise<string | null>;
  /** 二进制文件，不存在返回 null */
  readBytes(key: string): Promise<Uint8Array | null>;
  /** 列出某前缀下的对象 key */
  list(prefix: string): Promise<string[]>;
}

export class FsAssetSource implements AssetSource {
  constructor(private root: string) {}

  async readText(key: string): Promise<string | null> {
    const fs = await import('node:fs/promises');
    try {
      return await fs.readFile(`${this.root}/${key}`, 'utf8');
    } catch {
      return null;
    }
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const fs = await import('node:fs/promises');
    try {
      return new Uint8Array(await fs.readFile(`${this.root}/${key}`));
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = `${this.root}/${prefix}`;
    try {
      const names = await fs.readdir(dir);
      return names.map((n) => path.posix.join(prefix, n));
    } catch {
      return [];
    }
  }
}

export class R2AssetSource implements AssetSource {
  constructor(private bucket: R2Bucket) {}

  async readText(key: string): Promise<string | null> {
    const obj = await this.bucket.get(key);
    return obj ? await obj.text() : null;
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const buf = await obj.arrayBuffer();
    return new Uint8Array(buf);
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.bucket.list({ prefix, cursor });
      for (const obj of res.objects) out.push(obj.key);
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
    return out;
  }
}
