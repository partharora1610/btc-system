import Express, { Request, Response } from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import logger from '../middlewares/logger.middleware';
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

class Mempool {
  private static instance: Mempool;
  private transactions: Tx[] = [];

  private constructor() {}

  public static getInstance(): Mempool {
    if (!Mempool.instance) {
      Mempool.instance = new Mempool();
    }
    return Mempool.instance;
  }

  public addTransaction(tx: Tx) {
    this.transactions.push(tx);
  }

  public removeTransaction(tx: Tx) {
    this.transactions = this.transactions.filter((t) => t.hash !== tx.hash);
  }

  public getTransactions(limit?: number): Tx[] {
    return limit ? this.transactions.slice(0, limit) : this.transactions;
  }
}

const mempool = Mempool.getInstance();

const expressApp: Express.Application = Express();
const httpServer: HTTPServer = createServer(expressApp);
const wss: WebSocketServer = new WebSocketServer({ server: httpServer });

const miners: Map<string, WebSocket> = new Map();

expressApp.use(logger);
expressApp.use(Express.json());

wss.on('connection', (ws: WebSocket) => {
  const minerId = generateMinerId();
  console.log(`New miner connected: ${minerId}`);
  miners.set(minerId, ws);

  ws.send(
    JSON.stringify({
      type: 'MEMPOOL_UPDATE',
      transactions: mempool.getTransactions(100),
    }),
  );

  requestBlockchainForNewMiner(minerId, ws);

  ws.on('message', (message: string) => {
    const data = JSON.parse(message);
    switch (data.type) {
      case 'NEW_BLOCK':
        if (data.block) {
          console.log('Received new block, broadcasting to all miners');
          broadcastToMiners(data);
          data.block.transactions.forEach((tx: Tx) => mempool.removeTransaction(tx));
        }
        break;
      case 'BLOCKCHAIN_SHARE':
        forwardBlockchainToNewMiner(data.targetMinerId, data.blockchain);
        break;
    }
  });

  ws.on('close', () => {
    console.log(`Miner disconnected: ${minerId}`);
    miners.delete(minerId);
  });
});

function generateMinerId(): string {
  return 'miner_' + Math.random().toString(36).substr(2, 9);
}

function requestBlockchainForNewMiner(newMinerId: string, newMinerWs: WebSocket) {
  const existingMiners = Array.from(miners.entries()).filter(([id, _]) => id !== newMinerId);

  if (existingMiners.length > 0) {
    const [_, existingMinerWs] = existingMiners[Math.floor(Math.random() * existingMiners.length)];
    existingMinerWs.send(
      JSON.stringify({
        type: 'REQUEST_BLOCKCHAIN_SHARE',
        targetMinerId: newMinerId,
      }),
    );
  } else {
    newMinerWs.send(JSON.stringify({ type: 'BLOCKCHAIN_SYNC', blockchain: [] }));
  }
}

function forwardBlockchainToNewMiner(targetMinerId: string, blockchain: Block[]) {
  const targetMinerWs = miners.get(targetMinerId);
  if (targetMinerWs) {
    targetMinerWs.send(
      JSON.stringify({
        type: 'BLOCKCHAIN_SYNC',
        blockchain: blockchain,
      }),
    );
  }
}

function broadcastToMiners(message: any): void {
  miners.forEach((miner) => {
    if (miner.readyState === WebSocket.OPEN) {
      miner.send(JSON.stringify(message));
    }
  });
}

expressApp.get('/health', (_: Request, res: Response) => {
  return res.sendStatus(200);
});

expressApp.get('/', (_: Request, res: Response) => {
  return res.sendStatus(200);
});

expressApp.post('/transaction', (req: Request, res: Response) => {
  const { inputs, outputs } = req.body;
  const transaction = new Tx(inputs, outputs);
  console.log('Received new transaction');
  mempool.addTransaction(transaction);
  broadcastToMiners({ type: 'NEW_TRANSACTION', transaction });

  res.status(202).json({
    message: 'Transaction added to mempool',
    transactionHash: transaction.hash,
  });
});

export default httpServer;
