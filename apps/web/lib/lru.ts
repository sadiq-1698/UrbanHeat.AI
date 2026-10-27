/** Small least-recently-used cache (Map keeps insertion order; re-inserting on read moves an entry to the end). */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError("LruCache max must be a positive integer");
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}
