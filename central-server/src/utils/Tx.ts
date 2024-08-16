export class Tx {
  public hash: string;
  public from: string;
  public to: string;
  public amount: number;
  public fee: number;

  constructor(from: string, to: string, amount: number, fee: number) {
    this.from = from;
    this.to = to;
    this.amount = amount;
    this.fee = fee;
    this.hash = this.calculateHash();
  }

  private calculateHash(): string {
    return require('crypto')
      .createHash('sha256')
      .update(this.from + this.to + this.amount + this.fee)
      .digest('hex');
  }

  public getTxWeight(): number {
    return JSON.stringify(this).length;
  }

  public getTxFee(): number {
    return this.fee;
  }
}
