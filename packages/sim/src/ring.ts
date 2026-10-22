/**
 * Per-channel troop FIFO. Index 0 is the front (largest progress). Physical shift removal (Decision 2):
 * rows stay dense so the hash never depends on removal history. Capacity = aliveCap.
 * Progress of a row at tick T = p0 + (T - t0) * speed(kind); `seq` is the global troop id.
 */
export class TroopRing {
  len = 0;
  readonly p0: Int32Array;
  readonly t0: Int32Array;
  readonly owner: Int32Array;
  readonly kind: Int32Array;
  readonly seq: Int32Array;
  readonly hp: Int32Array;
  private readonly cols: readonly Int32Array[];

  constructor(readonly capacity: number) {
    this.p0 = new Int32Array(capacity); this.t0 = new Int32Array(capacity); this.owner = new Int32Array(capacity);
    this.kind = new Int32Array(capacity); this.seq = new Int32Array(capacity); this.hp = new Int32Array(capacity);
    this.cols = [this.p0, this.t0, this.owner, this.kind, this.seq, this.hp];
  }

  /** Append at the back (newest). Throws past capacity: the alive cap makes that a bug. */
  push(p0: number, t0: number, owner: number, kind: number, seq: number, hp: number): void {
    if (this.len >= this.capacity) throw new RangeError('TroopRing overflow');
    const i = this.len++;
    this.p0[i] = p0; this.t0[i] = t0; this.owner[i] = owner; this.kind[i] = kind; this.seq[i] = seq; this.hp[i] = hp;
  }

  /** Row index of troop `seq`, or -1. */
  indexOfSeq(seq: number): number {
    for (let i = 0; i < this.len; i++) if (this.seq[i] === seq) return i;
    return -1;
  }

  /** Remove row `i`, shifting later rows forward; vacated tail row is zeroed. */
  removeAt(i: number): void {
    if (i < 0 || i >= this.len) throw new RangeError('TroopRing.removeAt out of range');
    for (const col of this.cols) {
      for (let j = i; j < this.len - 1; j++) col[j] = col[j + 1]!;
      col[this.len - 1] = 0;
    }
    this.len--;
  }

  clear(): void {
    for (const col of this.cols) col.fill(0);
    this.len = 0;
  }
}
