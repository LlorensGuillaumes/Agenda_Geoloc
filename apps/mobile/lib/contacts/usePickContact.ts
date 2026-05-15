/**
 * Hook que carga los contactos del teléfono y los expone para un picker.
 *
 * - Pide permiso `READ_CONTACTS` la primera vez que se invoca `load()`.
 * - Filtra contactos sin teléfono (no nos sirven para llamar / WhatsApp).
 * - Ordena alfabéticamente por nombre.
 * - El consumidor (modal) implementa cercador y selección.
 *
 * Diseño: el `load()` se ejecuta on-demand, no al abrir la app. Así no
 * pedimos permiso si el usuario nunca toca "Triar de l'agenda".
 */
import { useCallback, useState } from 'react';
import * as Contacts from 'expo-contacts';

export type PickableContact = {
  id: string;
  name: string;
  phones: { label: string; number: string }[];
};

export type ContactsLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'ready'; contacts: PickableContact[] }
  | { status: 'error'; message: string };

function normalizeContact(c: Contacts.ExistingContact): PickableContact | null {
  const phones = (c.phoneNumbers ?? [])
    .map((p) => ({
      label: p.label ?? '',
      number: (p.number ?? '').trim(),
    }))
    .filter((p) => p.number.length > 0);
  if (phones.length === 0) return null;
  const name = (c.name ?? '').trim() || phones[0].number;
  return { id: c.id, name, phones };
}

export function usePickContact() {
  const [state, setState] = useState<ContactsLoadState>({ status: 'idle' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        setState({ status: 'denied', canAskAgain: perm.canAskAgain });
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      const normalized = data
        .map(normalizeContact)
        .filter((c): c is PickableContact => c !== null);
      // El sort de expo-contacts en Android no siempre es estable; reordenamos.
      normalized.sort((a, b) => a.name.localeCompare(b.name, undefined, {
        sensitivity: 'base',
      }));
      setState({ status: 'ready', contacts: normalized });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, load, reset };
}
