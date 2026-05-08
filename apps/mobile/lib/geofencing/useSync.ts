import { useEffect, useRef, useState } from 'react';
import { useAlarms } from '../alarms/hooks';
import { usePlaces } from '../places/hooks';
import { useAuthStore } from '../auth/store';
import {
  syncGeofences,
  unregisterAllGeofences,
  type SyncResult,
} from './index';

export type GeofenceSyncState = {
  lastResult: SyncResult | null;
  lastError: string | null;
};

/**
 * Mantiene los geofences nativos sincronizados con las alarmas activas del
 * usuario. Ejecuta resync cuando alarmas o lugares cambian. Si no hay
 * autenticación, desactiva todos los geofences.
 *
 * Diseñado para montarse una sola vez (en (tabs)/_layout).
 */
export function useGeofenceSync(): GeofenceSyncState {
  const { data: alarms } = useAlarms();
  const { data: places } = usePlaces();
  const status = useAuthStore((s) => s.status);

  const [state, setState] = useState<GeofenceSyncState>({
    lastResult: null,
    lastError: null,
  });
  const lastFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') {
      lastFingerprint.current = null;
      unregisterAllGeofences().catch(() => {});
      return;
    }
    if (!alarms || !places) return;

    const fingerprint = JSON.stringify({
      a: alarms
        .filter((a) => a.isActive && a.triggerType !== 'time' && a.locationConfig)
        .map((a) => ({
          id: a.id,
          t: a.title,
          n: a.notes,
          c: a.locationConfig,
        })),
      p: places.map((p) => ({
        id: p.id,
        lat: p.latitude,
        lng: p.longitude,
        r: p.radiusMeters,
      })),
    });
    if (fingerprint === lastFingerprint.current) return;
    lastFingerprint.current = fingerprint;

    syncGeofences({ alarms, places })
      .then((res) => setState({ lastResult: res, lastError: null }))
      .catch((err) =>
        setState({
          lastResult: null,
          lastError: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [alarms, places, status]);

  return state;
}
