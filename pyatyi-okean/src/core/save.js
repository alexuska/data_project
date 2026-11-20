// Сохранение профиля игрока в localStorage. Всё обёрнуто в try/catch:
// в приватном окне или в превью хранилище может быть недоступно — игра обязана работать и без него.
const KEY = 'pyatyi-okean-profile-v1';

export function defaultProfile() {
  return {
    version: 1,
    pilotName: 'Пилот',
    money: 1500,
    xp: 0,
    owned: ['yak52'],            // id купленных самолётов
    selectedPlane: 'yak52',
    upgrades: {},                // { [planeId]: { engine: 0..3, ... } } — формат задаёт career
    liveries: {},                // { [planeId]: liveryId }
    missions: {},                // { [missionId]: { stars: 0..3, best: number, done: n } }
    achievements: {},            // { [id]: timestamp }
    stats: {
      flights: 0, flightTime: 0, distance: 0,
      landings: 0, perfectLandings: 0, crashes: 0,
      kills: 0, groundKills: 0, passengers: 0, cargo: 0,
      perPlane: {},              // { [planeId]: { time, flights, landings } }
    },
    logbook: [],                 // последние полёты: { t, plane, mission, result, time, landing }
    settings: {
      quality: 'auto',           // 'low' | 'medium' | 'high' | 'auto'
      sound: 0.8,
      music: 0.5,
      invertPitch: false,        // false: стик на себя (вниз) = нос вверх, как в самолёте
      assist: true,              // помощь в пилотировании (автокоординация, мягкое сваливание)
      sensitivity: 1,
      controlScheme: 'stick',    // 'stick' | 'tilt' (если доступно)
      units: 'metric',
      leftHanded: false,
      tutorialDone: false,
    },
    seen: {},                    // флаги показанных подсказок
  };
}

function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const k of Object.keys(extra)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && typeof extra[k] === 'object' && !Array.isArray(extra[k])) {
      merge(base[k], extra[k]);
    } else {
      base[k] = extra[k];
    }
  }
  return base;
}

export function loadProfile() {
  const p = defaultProfile();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(p, JSON.parse(raw));
  } catch (e) {
    /* хранилище недоступно — играем с профилем по умолчанию */
  }
  return p;
}

let saveTimer = 0;
export function saveProfile(profile, immediate = false) {
  const write = () => {
    saveTimer = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(profile));
    } catch (e) {
      /* нет места или хранилище запрещено */
    }
  };
  if (immediate) {
    clearTimeout(saveTimer);
    write();
  } else if (!saveTimer) {
    saveTimer = setTimeout(write, 400);
  }
}

export function resetProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) { /* ignore */ }
  return defaultProfile();
}
