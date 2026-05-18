import { Alert, Platform } from 'react-native';
import {
  getManufacturer,
  hasManufacturerHardening,
  markHardeningPrompted,
  openAutostartSettings,
  requestIgnoreBatteryOptimization,
  wasHardeningPrompted,
} from '../system-hardening';

/**
 * Si l'usuari encara no ha vist mai els passos de "resistència a segon pla",
 * mostra un diàleg que els proposa. Pensat per llançar-se en moments naturals
 * — per exemple, just després de crear la primera alarma de geofencing —
 * així no requereix anar a buscar els ajustos.
 *
 * No fa res a iOS ni si l'usuari ja l'ha vist abans.
 */
export async function maybePromptHardening(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (await wasHardeningPrompted()) return;

  await markHardeningPrompted();

  const manufacturer = getManufacturer();
  const hasAutostart = hasManufacturerHardening();
  const manufacturerLabel =
    manufacturer === 'other' ? 'el teu mòbil' : manufacturer;

  Alert.alert(
    'Mantén el geofencing actiu',
    `Perquè ${manufacturerLabel} no aturi el servei mentre vas pel carrer, et recomanem dos ajustos ràpids. Els pots canviar després a Ajustos → Permisos.`,
    [
      { text: 'Més tard', style: 'cancel' },
      {
        text: 'Bateria',
        onPress: async () => {
          try {
            await requestIgnoreBatteryOptimization();
          } catch {
            // ignore
          }
          if (hasAutostart) {
            // Encadenem el següent: l'usuari ja està en mode "vinga, fem-ho"
            setTimeout(() => promptAutostart(manufacturer), 400);
          }
        },
      },
      ...(hasAutostart
        ? [
            {
              text: 'Autostart',
              onPress: () => promptAutostart(manufacturer),
            },
          ]
        : []),
    ],
  );
}

function promptAutostart(manufacturer: string): void {
  Alert.alert(
    `Autostart (${manufacturer})`,
    "S'obrirà la pantalla d'Autostart del fabricant. Activa l'interruptor de Agenda.",
    [
      { text: 'Cancel·la', style: 'cancel' },
      {
        text: 'Obrir',
        onPress: async () => {
          const ok = await openAutostartSettings();
          if (!ok) {
            Alert.alert(
              'No s\'ha pogut obrir',
              "No hem trobat aquesta pantalla al teu dispositiu. Busca-la manualment a Ajustos.",
            );
          }
        },
      },
    ],
  );
}
