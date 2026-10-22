import { parentPort } from 'node:worker_threads';
import { runBalanceMatch, type BalanceTask } from './balance-match.js';
if (!parentPort) throw new Error('Balance worker requires a parent port');
parentPort.on('message', ({index,task}:{index:number;task:BalanceTask}) => {
  try { parentPort!.postMessage({index,result:runBalanceMatch(task)}); }
  catch (error) { parentPort!.postMessage({index,error:(error as Error).message}); }
});
