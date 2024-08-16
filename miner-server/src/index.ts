import WebSocket from 'ws';
import crypto from 'crypto';

export class Tx {
  public hash: string;
  public inputs: { txid: string; index: number; amount: number }[];
  public outputs: { address: string; amount: number }[];

  constructor(inputs: { txid: string; index: number; amount: number }[], outputs: { address: string; amount: number }[]) {
    this.inputs = inputs;
    this.outputs = outputs;
    this.hash = this.calculateHash();
  }

  private calculateHash(): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(this.inputs) + JSON.stringify(this.outputs))
      .digest('hex');
  }

  public getTxWeight(): number {
    return JSON.stringify(this).length;
  }

  public getTxFee(): number {
    const inputSum = this.inputs.reduce((sum, input) => sum + input.amount, 0);
    const outputSum = this.outputs.reduce((sum, output) => sum + output.amount, 0);
    return inputSum - outputSum;
  }
}

interface Block {
  index: number;
  timestamp: number;
  transactions: Tx[];
  previousHash: string;
  hash: string;
  nonce: number;
}

interface UTXO {
  txid: string;
  index: number;
  amount: number;
  address: string;
}

class MinerServer {
  private ws: WebSocket;
  private blockchain: Block[] = [];
  private mempool: Tx[] = [];
  private utxoSet: Map<string, UTXO> = new Map();
  private difficulty = 3;
  private isMining: boolean = false;

  constructor(centralServerUrl: string) {
    this.ws = new WebSocket(centralServerUrl);
    this.setupWebSocket();
    this.initializeBlockchain();
  }

  public startMining() {
    setInterval(() => {
      if (!this.isMining && this.mempool.length > 0) {
        this.mineNextBlock();
      }
    }, 10000);
  }

  private async mineNextBlock() {
    this.isMining = true;
    console.log('Starting to mine a new block...');

    try {
      // currently selecting first 10 transactions from mempool
      // later we will use greedy algo to select transactions
      const transactions = this.mempool.slice(0, 10);
      const newBlock = await this.mineBlock(transactions);

      if (this.isValidNewBlock(newBlock, this.getLatestBlock())) {
        this.blockchain.push(newBlock);
        this.updateUTXOSet(newBlock);
        this.ws.send(JSON.stringify({ type: 'NEW_BLOCK', block: newBlock }));
        console.log('Mined and broadcast new block:', newBlock.hash);
        // Clear mined transactions from mempool
        this.mempool = this.mempool.filter((tx) => !transactions.find((minedTx) => minedTx.hash === tx.hash));
      } else {
        console.log('Mined an invalid block. Discarding.');
      }
    } catch (error) {
      console.error('Error during mining:', error);
    } finally {
      this.isMining = false;
    }
  }

  private async mineBlock(transactions: Tx[]): Promise<Block> {
    const newBlock: Block = {
      index: this.blockchain.length,
      timestamp: Date.now(),
      transactions: transactions,
      previousHash: this.getLatestBlock().hash,
      hash: '',
      nonce: 0,
    };

    while (true) {
      newBlock.hash = this.calculateBlockHash(newBlock);
      if (newBlock.hash.substring(0, this.difficulty) === Array(this.difficulty + 1).join('0')) {
        break;
      }
      newBlock.nonce++;
    }

    return newBlock;
  }

  private setupWebSocket() {
    this.ws.on('open', () => {
      console.log('Connected to central server');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString());
      switch (message.type) {
        case 'MEMPOOL_UPDATE':
          this.updateMempool(message.transactions);
          break;
        case 'NEW_TRANSACTION':
          this.addTransaction(message.transaction);
          break;
        case 'NEW_BLOCK':
          this.handleNewBlock(message.block);
          break;
        case 'REQUEST_BLOCKCHAIN_SHARE':
          this.shareBlockchain(message.targetMinerId);
          break;
        case 'BLOCKCHAIN_SYNC':
          this.syncBlockchain(message.blockchain);
          break;
      }
    });
  }

  private initializeBlockchain() {
    const genesisBlock: Block = {
      index: 0,
      timestamp: Date.now(),
      transactions: [],
      previousHash: '0',
      hash: '0',
      nonce: 0,
    };
    this.blockchain.push(genesisBlock);
    this.updateUTXOSet(genesisBlock);
  }

  private shareBlockchain(targetMinerId: string) {
    this.ws.send(
      JSON.stringify({
        type: 'BLOCKCHAIN_SHARE',
        targetMinerId: targetMinerId,
        blockchain: this.blockchain,
      }),
    );
  }

  private syncBlockchain(newBlockchain: Block[]) {
    if (this.isValidChain(newBlockchain) && newBlockchain.length > this.blockchain.length) {
      console.log('Received a longer valid blockchain. Syncing...');
      this.blockchain = newBlockchain;
      this.mempool = [];
      this.rebuildUTXOSet();
    } else {
      console.log('Received blockchain is not valid or not longer than current chain. Ignoring.');
    }
  }

  private rebuildUTXOSet() {
    this.utxoSet.clear();
    this.blockchain.forEach((block) => this.updateUTXOSet(block));
  }

  private updateUTXOSet(block: Block) {
    block.transactions.forEach((tx) => {
      tx.inputs.forEach((input) => {
        const utxoKey = `${input.txid}:${input.index}`;
        this.utxoSet.delete(utxoKey);
      });

      tx.outputs.forEach((output, index) => {
        const utxoKey = `${tx.hash}:${index}`;

        this.utxoSet.set(utxoKey, {
          txid: tx.hash,
          index: index,
          amount: output.amount,
          address: output.address,
        });
      });
    });
  }

  private isValidChain(chain: Block[]): boolean {
    for (let i = 1; i < chain.length; i++) {
      const currentBlock = chain[i];
      const previousBlock = chain[i - 1];

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }

      if (currentBlock.hash !== this.calculateBlockHash(currentBlock)) {
        return false;
      }

      // Validate all transactions in the block
      if (!currentBlock.transactions.every((tx) => this.verifyTransaction(tx))) {
        return false;
      }
    }
    return true;
  }

  private updateMempool(transactions: Tx[]) {
    this.mempool = transactions.filter((tx) => this.verifyTransaction(tx));
  }

  private addTransaction(transaction: Tx) {
    if (this.verifyTransaction(transaction)) {
      this.mempool.push(transaction);
    }
  }

  private verifyTransaction(transaction: Tx): boolean {
    let inputSum = 0;
    for (const input of transaction.inputs) {
      const utxoKey = `${input.txid}:${input.index}`;
      const utxo = this.utxoSet.get(utxoKey);
      if (!utxo || utxo.amount !== input.amount) {
        return false;
      }
      inputSum += input.amount;
    }

    const outputSum = transaction.outputs.reduce((sum, output) => sum + output.amount, 0);
    return inputSum >= outputSum;
  }

  private handleNewBlock(block: Block) {
    if (this.isValidNewBlock(block, this.getLatestBlock())) {
      this.blockchain.push(block);
      this.updateUTXOSet(block);
      console.log('New block added to the chain');

      this.mempool = this.mempool.filter((tx) => !block.transactions.find((blockTx) => blockTx.hash === tx.hash));
    } else {
      console.log('Received invalid block');
    }
  }

  private isValidNewBlock(newBlock: Block, previousBlock: Block): boolean {
    if (previousBlock.index + 1 !== newBlock.index) {
      return false;
    }
    if (previousBlock.hash !== newBlock.previousHash) {
      return false;
    }
    if (this.calculateBlockHash(newBlock) !== newBlock.hash) {
      return false;
    }
    return newBlock.transactions.every((tx) => this.verifyTransaction(tx));
  }

  private getLatestBlock(): Block {
    return this.blockchain[this.blockchain.length - 1];
  }

  private calculateBlockHash(block: Block): string {
    return crypto
      .createHash('sha256')
      .update(block.index + block.previousHash + block.timestamp + JSON.stringify(block.transactions) + block.nonce)
      .digest('hex');
  }

  public getBalance(address: string): number {
    let balance = 0;
    for (const utxo of this.utxoSet.values()) {
      if (utxo.address === address) {
        balance += utxo.amount;
      }
    }
    return balance;
  }
}

const miner = new MinerServer('ws://localhost:8000');
miner.startMining();
