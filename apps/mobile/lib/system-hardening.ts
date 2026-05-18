/**
 * Helpers per demanar permisos del sistema Android necessaris perquè el
 * foreground service del geofencing sobrevisqui a fabricants agressius
 * (Xiaomi/MIUI, Huawei/EMUI, Oppo/ColorOS, etc.).
 *
 * No hi ha API per detectar l'estat actual de la majoria d'aquests permisos.
 * El patró és: oferir el botó, l'usuari l'accepta una vegada, marquem que
 * ja li hem demanat i no tornem a empipar tret que ell ho demani.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Càrrega lazy: si l'APK és antic i no té el mòdul natiu instal·lat, no
// volem cruixir al carregar el mòdul (que petaria tota la pantalla d'Ajustos
// al usuari amb APK desactualitzat fins que apliqui un OTA).
async function getIntentLauncher() {
  try {
    return await import('expo-intent-launcher');
  } catch {
    return null;
  }
}

type Manufacturer = 'xiaomi' | 'huawei' | 'oppo' | 'vivo' | 'samsung' | 'other';

const PROMPTED_KEY = 'system-hardening:prompted-v1';

export function getManufacturer(): Manufacturer {
  if (Platform.OS !== 'android') return 'other';
  const raw = String(
    (Platform.constants as { Manufacturer?: string }).Manufacturer ?? '',
  ).toLowerCase();
  if (raw.includes('xiaomi') || raw.includes('redmi') || raw.includes('poco'))
    return 'xiaomi';
  if (raw.includes('huawei') || raw.includes('honor')) return 'huawei';
  if (raw.includes('oppo') || raw.includes('realme')) return 'oppo';
  if (raw.includes('vivo')) return 'vivo';
  if (raw.includes('samsung')) return 'samsung';
  return 'other';
}

/**
 * Llança el diàleg natiu d'Android per demanar exempció d'optimització de
 * bateria per a la nostra app. L'usuari veu un popup amb un sol toc.
 *
 * Si l'app ja està exempta, el sistema simplement no mostra res.
 */
export async function requestIgnoreBatteryOptimization(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const IntentLauncher = await getIntentLauncher();
  if (!IntentLauncher) return;
  const appId = Constants.expoConfig?.android?.package ?? 'dev.llorensguillaumes.agenda';
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
    { data: `package:${appId}` },
  );
}

/**
 * Obre la pantalla de "battery optimization" general (llista d'apps), per si
 * l'usuari vol revisar-la manualment.
 */
export async function openBatteryOptimizationList(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const IntentLauncher = await getIntentLauncher();
  if (!IntentLauncher) return;
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  );
}

/**
 * Obre directament la pàgina d'Autostart al fabricant detectat (Xiaomi,
 * Huawei, Oppo, Vivo). Retorna `true` si ha pogut llançar l'activity i
 * `false` si el fabricant no és reconegut o el component no existeix al
 * dispositiu (vell o ROM diferent).
 */
export async function openAutostartSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const IntentLauncher = await getIntentLauncher();
  if (!IntentLauncher) return false;
  const targets: { packageName: string; className: string }[] = [];
  const m = getManufacturer();
  if (m === 'xiaomi') {
    targets.push({
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
    });
  } else if (m === 'huawei') {
    targets.push(
      {
        packageName: 'com.huawei.systemmanager',
        className:
          'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
      },
      {
        packageName: 'com.huawei.systemmanager',
        className: 'com.huawei.systemmanager.optimize.process.ProtectActivity',
      },
    );
  } else if (m === 'oppo') {
    targets.push(
      {
        packageName: 'com.coloros.safecenter',
        className:
          'com.coloros.safecenter.permission.startup.StartupAppListActivity',
      },
      {
        packageName: 'com.coloros.safecenter',
        className:
          'com.coloros.safecenter.startupapp.StartupAppListActivity',
      },
    );
  } else if (m === 'vivo') {
    targets.push({
      packageName: 'com.vivo.permissionmanager',
      className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
    });
  }

  for (const t of targets) {
    try {
      await IntentLauncher.startActivityAsync(
        'android.intent.action.MAIN',
        { packageName: t.packageName, className: t.className },
      );
      return true;
    } catch {
      // try next target
    }
  }
  return false;
}

/**
 * Indica si tenim alguna acció específica del fabricant a oferir.
 */
export function hasManufacturerHardening(): boolean {
  const m = getManufacturer();
  return m === 'xiaomi' || m === 'huawei' || m === 'oppo' || m === 'vivo';
}

/**
 * Obre la pantalla de detalls de l'app (Settings → Apps → Agenda) on l'usuari
 * pot revisar permisos, notificacions, bateria, etc.
 */
export async function openAppDetailSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const IntentLauncher = await getIntentLauncher();
  if (!IntentLauncher) return;
  const appId = Constants.expoConfig?.android?.package ?? 'dev.llorensguillaumes.agenda';
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
    { data: `package:${appId}` },
  );
}

/**
 * MIUI/Xiaomi: obre la pàgina "Altres permisos" de la nostra app, on hi ha
 * "Iniciar en segon pla", "Mostrar finestres emergents", etc.
 * Fallback a APPLICATION_DETAILS_SETTINGS si el target específic no existeix.
 */
export async function openMiuiOtherPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (getManufacturer() !== 'xiaomi') return false;
  const IntentLauncher = await getIntentLauncher();
  if (!IntentLauncher) return false;
  const appId = Constants.expoConfig?.android?.package ?? 'dev.llorensguillaumes.agenda';
  const targets: { packageName: string; className: string; extra?: Record<string, unknown> }[] = [
    {
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.permissions.PermissionsEditorActivity',
      extra: { extra_pkgname: appId },
    },
    {
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.permissions.AppPermissionsEditorActivity',
      extra: { extra_pkgname: appId },
    },
  ];
  for (const t of targets) {
    try {
      await IntentLauncher.startActivityAsync(
        'miui.intent.action.APP_PERM_EDITOR',
        { packageName: t.packageName, className: t.className, extra: t.extra },
      );
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

/**
 * MIUI: obre la configuració d'estalvi de bateria de l'app específic (on
 * hi ha "Sense restriccions" / "Battery saver" / "Restricted").
 */
export async function openMiuiBatterySaver(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (getManufacturer() !== 'xiaomi') return false;
  const IntentLauncher = await getIntentLauncher();
  if (!IntentLauncher) return false;
  const appId = Constants.expoConfig?.android?.package ?? 'dev.llorensguillaumes.agenda';
  try {
    await IntentLauncher.startActivityAsync(
      'miui.intent.action.HIDDEN_APPS_CONFIG_ACTIVITY',
      {
        packageName: 'com.miui.powerkeeper',
        className: 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity',
        extra: { package_name: appId },
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Marca que ja hem ofert el bundle de hardening a l'usuari un cop, perquè
 * no l'empipem cada vegada que crea una alarma de geofencing.
 */
export async function markHardeningPrompted(): Promise<void> {
  await AsyncStorage.setItem(PROMPTED_KEY, String(Date.now()));
}

export async function wasHardeningPrompted(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(PROMPTED_KEY);
  return raw != null;
}
