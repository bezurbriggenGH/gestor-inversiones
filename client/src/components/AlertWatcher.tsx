import { useEffect, useRef } from 'react';
import { useAlerts } from '../hooks';
import { money } from '../format';

/** Muestra una notificación del navegador cuando se dispara una alerta nueva. */
export function AlertWatcher() {
  const { data } = useAlerts();
  const notified = useRef(new Set<number>());

  useEffect(() => {
    if (!data || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const a of data) {
      if (!a.triggered_at || a.seen || notified.current.has(a.id)) continue;
      notified.current.add(a.id);
      new Notification(`${a.ticker} ${a.direction === 'ARRIBA' ? 'subió' : 'bajó'} a ${money(a.trigger_price ?? 0, 'ARS')}`, {
        body: `Tu alerta era ${a.direction === 'ARRIBA' ? 'por encima' : 'por debajo'} de ${money(a.price, 'ARS')}`,
        icon: '/icon.svg',
      });
    }
  }, [data]);

  return null;
}
