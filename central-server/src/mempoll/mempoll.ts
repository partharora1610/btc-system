import { Tx } from 'utils/Tx';

export class Mempool {
  private static instance: Mempool;
  public mempool: Tx[] = [];

  private constructor() {
    if (Mempool.instance) {
      return Mempool.instance;
    }

    Mempool.instance = this;
  }

  public addTransaction(tx: Tx) {
    this.mempool.push(tx);
    this.sortMempool();
  }

  public removeTransaction(tx: Tx) {
    this.mempool = this.mempool.filter((t) => t.hash !== tx.hash);
  }

  public static getInstance(): Mempool {
    if (!Mempool.instance) {
      Mempool.instance = new Mempool();
    }
    return Mempool.instance;
  }

  public getTransactions(limit: number): Tx[] {
    return this.mempool.slice(0, limit);
  }

  private sortMempool() {
    this.mempool.sort((a, b) => b.getTxFee() / b.getTxWeight() - a.getTxFee() / a.getTxWeight());
  }
}
