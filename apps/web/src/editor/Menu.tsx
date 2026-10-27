export type MenuItem = { id: string; separator: true } | { id: string; label: string; onSelect(): void; disabled?: boolean; kbd?: string; separator?: false };
export interface MenuProps {
  id: string;
  label: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  items: readonly MenuItem[];
  disabled?: boolean;
  triggerTestId?: string;
  testId?: string;
}
/** Controlled menu; native button activation handles both Enter and Space once. */
export function Menu(p: MenuProps) {
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const initial = useRef<'first' | 'last'>('first');
  const tabbing = useRef(false);
  const [active, setActive] = useState('');
  const visible = p.open && !p.disabled;
  useDismiss({ enabled: visible, refs: [menu, trigger], triggerRef: trigger, onDismiss: () => p.onOpenChange(false) });
  const buttons = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  useLayoutEffect(() => {
    if (!visible) return;
    const available = buttons();
    const first = initial.current === 'last' ? available.at(-1) : available[0];
    (first ?? menu.current)?.focus();
    initial.current = 'first';
  }, [visible]);
  return <span style={{ position: 'relative', display: 'inline-flex' }}>
    <button ref={trigger} id={`${p.id}-trigger`} type="button" class="ed-btn" data-testid={p.triggerTestId} disabled={p.disabled}
      aria-haspopup="menu" aria-expanded={visible} aria-controls={visible ? p.id : undefined}
      onClick={() => p.onOpenChange(!visible)}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        initial.current = event.key === 'ArrowUp' ? 'last' : 'first';
        if (visible) {
          const available = buttons();
          (initial.current === 'last' ? available.at(-1) : available[0])?.focus();
        } else p.onOpenChange(true);
      }}>{p.label}</button>
    {visible && <div ref={menu} id={p.id} role="menu" aria-labelledby={`${p.id}-trigger`} tabIndex={-1} class="ed-menu" data-testid={p.testId}
      style={{ position: 'absolute', top: '100%', left: 0 }}
      onBlurCapture={event => {
        if (tabbing.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) p.onOpenChange(false);
        tabbing.current = false;
      }}
      onKeyDown={event => {
        if (event.key === 'Tab') tabbing.current = true;
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const available = buttons();
        if (!available.length) return;
        const current = available.indexOf(document.activeElement as HTMLButtonElement);
        available[(current + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]?.focus();
      }}>
      {p.items.map(item => item.separator ? <div key={item.id} class="ed-menu-sep" role="separator" /> :
        <button key={item.id} type="button" role="menuitem" class="ed-menu-item" data-testid={item.id} disabled={item.disabled}
          tabIndex={active === item.id ? 0 : -1} onFocus={() => setActive(item.id)}
          onClick={() => { p.onOpenChange(false); trigger.current?.focus(); item.onSelect(); }}>
          {item.label}{item.kbd && <span class="ed-menu-kbd">{item.kbd}</span>}
        </button>)}
    </div>}
  </span>;
}
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useDismiss } from './useDismiss.js';

