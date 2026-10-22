import { Worker } from 'node:worker_threads';
import type { BalanceTask, BalanceMatch } from './balance-match.js';
/** Results stay in dispatch order; every worker owns fresh per-task controllers. */
export async function runBalancePool(tasks: readonly BalanceTask[], jobs: number, workerUrl = new URL('./balance-worker.mjs',import.meta.url)): Promise<BalanceMatch[]> {
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new RangeError('Jobs must be a positive safe integer');
  if (!tasks.length) return [];
  const workers: Worker[] = [];
  try {
    return await new Promise<BalanceMatch[]>((resolve,reject) => {
      const results: BalanceMatch[] = new Array(tasks.length);
      let next = 0, completed = 0, settled = false;
      const fail = (error: Error) => { if (!settled) {settled = true; reject(error);} };
      for (let n = 0; n < Math.min(jobs,tasks.length); n++) {
        let worker: Worker;
        try { worker = new Worker(workerUrl); workers.push(worker); }
        catch (error) { fail(error as Error); break; }
        let active: number | undefined;
        const dispatch = () => {
          if (settled || next === tasks.length) {active=undefined; return;}
          active = next++;
          try { worker.postMessage({index:active,task:tasks[active]}); }
          catch (error) { fail(error as Error); }
        };
        worker.on('error',fail);
        worker.on('exit',code=> {if (!settled) fail(new Error(`Balance worker exited before completing the suite (code ${code})`));});
        worker.on('message', (message: {index?:number;result?:BalanceMatch;error?:string}) => {
          if (settled) return;
          if (active === undefined || message?.index !== active) {fail(new Error('Invalid balance worker response')); return;}
          if (message.error !== undefined) {fail(new Error(`${tasks[active]!.level.id} seed ${tasks[active]!.seed} rotation ${tasks[active]!.rotation}: ${message.error}`)); return;}
          const expected = tasks[active]!, result = message.result;
          if (!result || result.level !== expected.level.id || result.seed !== expected.seed || result.rotation !== expected.rotation ||
              typeof result.finalHash !== 'string' || !/^[a-f0-9]{16}$/.test(result.finalHash) ||
              !Array.isArray(result.observations) || result.observations.length !== expected.seats.length ||
              result.observations.some((observation,index) => !observation ||
                observation.player !== expected.seats[index]!.player || observation.profile !== expected.seats[index]!.profile.id ||
                typeof observation.won !== 'boolean' || typeof observation.timeout !== 'boolean' || typeof observation.draw !== 'boolean' ||
                (observation.won && (observation.timeout || observation.draw)) ||
                !Number.isFinite(observation.seconds) || observation.seconds < 0 || !Number.isSafeInteger(observation.towers) || observation.towers < 0)) {
            fail(new Error('Invalid balance worker result')); return;
          }
          results[active] = result;
          if (++completed === tasks.length) {settled=true; resolve(results); return;}
          dispatch();
        });
        dispatch();
      }
    });
  } finally { await Promise.all(workers.map(worker=>worker.terminate())); }
}
