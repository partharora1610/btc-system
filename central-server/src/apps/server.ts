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

const miners: Set<WebSocket> = new Set();

expressApp.use(logger);
expressApp.use(Express.json());

wss.on('connection', (ws: WebSocket) => {
  console.log('New miner connected');
  miners.add(ws);

  ws.send(
    JSON.stringify({
      type: 'MEMPOOL_UPDATE',
      transactions: mempool.getTransactions(100),
    }),
  );

  ws.on('message', (message: string) => {
    const data = JSON.parse(message);
    if (data.type === 'NEW_BLOCK' && data.block) {
      console.log('Received new block, broadcasting to all miners');
      broadcastToMiners(data);
      data.block.transactions.forEach((tx: Tx) => mempool.removeTransaction(tx));
    }
  });

  ws.on('close', () => {
    console.log('Miner disconnected');
    miners.delete(ws);
  });
});

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
