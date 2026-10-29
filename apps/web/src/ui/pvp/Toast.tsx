export function Toast({message,testId}:{message:string;testId:string}){
  return <p class="pvp-toast" role="status" aria-live="polite" data-testid={testId}>{message}</p>;
}
export const DESYNC_TOAST='Out of sync with server';
