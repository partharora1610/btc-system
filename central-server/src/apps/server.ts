import Express, { Request, Response } from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import logger from '../middlewares/logger.middleware';
import { Mempool } from 'mempoll/mempoll';
import { Tx } from 'utils/Tx';

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
    const [__, existingMinerWs] = existingMiners[Math.floor(Math.random() * existingMiners.length)];
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

function forwardBlockchainToNewMiner(targetMinerId: string, blockchain: any) {
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
  const { from, to, amount, fee } = req.body;
  const transaction = new Tx(from, to, amount, fee);
  console.log('Received new transaction');
  mempool.addTransaction(transaction);
  broadcastToMiners({ type: 'NEW_TRANSACTION', transaction });

  res.status(202).json({
    message: 'Transaction added to mempool',
    transactionHash: transaction.hash,
  });
});

export default httpServer;
