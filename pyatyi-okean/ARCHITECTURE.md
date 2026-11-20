# Пятый океан — архитектура и контракты модулей

Игра-подарок для папы, который очень любит самолёты. Он играет **на телефоне или планшете** (сенсорный экран, в основном альбомная ориентация). Он должен захотеть возвращаться к игре несколько вечеров подряд.

- **Жанр:** 3D-полёты на военных и гражданских самолётах: карьера и ангар, гражданские рейсы, боевые вылеты, свободный полёт.
- **Стиль:** стилизованное low-poly (гранёные плоскости, тёплый свет, атмосферная дымка, красивое небо). Красота — половина игры.
- **Сложность:** «золотая середина» — ощущение настоящего полёта (тяга, закрылки, шасси, сваливание, посадка), но без чтения инструкций; есть помощь.
- **Язык:** весь текст на русском, авиационная лексика (РУД, шасси, закрылки, глиссада, «Взлёт разрешаю»). Реальные типы самолётов и уважение к их истории.
- **Тон боевых заданий:** противник условный и безымянный («условный противник», учения, вымышленный архипелаг). Никаких реальных стран, конфликтов и политики.

## Технологии и команды

- three.js 0.170 (npm), ES-модули в `src/`, сборка esbuild в один `game.js`. Никаких внешних ассетов и сетевых запросов: вся графика, звук и данные — процедурно, кодом.
- Сборка в **свой** каталог (чтобы не мешать другим агентам): `node build.mjs --out out/<ваше-имя>` (флаг `--dev` — без минификации). Каталог `out/` в .gitignore.
- Тестовый стенд (headless Chromium + WebGL): `node tools/shot.cjs --dist out/<ваше-имя> --query "start=free&plane=an2&air=1" --do "advance:5" --do "shot:shots/<ваше-имя>-1.png"`. Справка — в шапке `tools/shot.cjs`. Скриншоты смотрите инструментом Read. **Обязательно смотрите на свой результат глазами** — и на телефонном размере 844×390 (`--size 844x390 --touch`), и на планшете 1180×820.
- Реальное время в headless идёт медленно (несколько кадров/с): для логики и физики используйте `advance:<сек>` (прокрутка симуляции), а `wait` — только чтобы дать отрисоваться. Скриншоты дорогие по CPU (на машине 4 ядра, работают несколько агентов) — делайте их осмысленно, не десятками.
- URL-параметры для тестов: `start=free`, `plane=<id>`, `airport=<id>`, `air=1` (старт в воздухе), `alt=<м>`, `mission=<id>`, `tod=<часы>`, `weather=<тип>`.
- В консоли страницы: `__G` — контекст игры, `__G.debug.advance(сек)`, `__G.debug.info()`, `__G.debug.teleport({x,y,z,heading,speed})`, `__G.debug.hold({pitch,roll,yaw,throttle,brake})` / `hold(null)`.

## Правила совместной работы (важно)

1. **У каждого файла один владелец.** Правьте только свои файлы (список — в вашем задании). Чужие файлы только читайте. Нужна правка в чужом модуле или в ядре (`src/main.js`, `src/core/*`) — не делайте её, опишите в итоговом отчёте, что и зачем нужно.
2. **Не меняйте публичные контракты** из этого документа (имена, сигнатуры, смысл, единицы). Расширять можно (новые методы/поля), ломать нельзя.
3. **Никаких git-команд, меняющих состояние** (commit, checkout, stash, reset, add). Коммиты делает ведущий.
4. Чужой модуль может быть в середине правки, и сборка временно упадёт не по вашей вине — подождите 20–30 секунд и повторите.
5. Ошибка в `update()` любого модуля ловится ядром и не роняет игру, но счётчик ошибок `__G.errors` должен быть пустым — проверяйте его в конце работы (стенд печатает).
6. В симуляции используйте `G.time.sim` и `dt`, а не `Date.now()`/`performance.now()` — иначе сломается прокрутка времени.
7. Профиль игрока — только через `G.profile` и `saveProfile()` из `core/save.js`. Прямой `localStorage` запрещён. Формат профиля расширять можно (с значениями по умолчанию), ломать нельзя.
8. Нет `alert/confirm/prompt` (на площадке публикации они не работают) — только собственные диалоги.
9. Не создавайте документацию, планы и прочие лишние файлы. Нужны только код и короткий итоговый отчёт в ответе.

## Бюджет производительности (телефон среднего класса, 60 к/с)

- Вызовов отрисовки в кадре: до ~150. Треугольников: до ~400 тыс. Объединяйте геометрию (`mergeGeometries`), используйте `InstancedMesh`, общий материал с vertexColors.
- Материалы: `MeshLambertMaterial`/`MeshBasicMaterial`, `flatShading`. Без постобработки и без теней реального времени по умолчанию (тень самолёта — «блоб»). Дорогие вещи — только на `G.quality.level === 'high'`.
- Никаких аллокаций в горячих циклах (`new Vector3` в update — нельзя; заводите временные объекты на уровне модуля).
- Текстуры — только процедурные (canvas/DataTexture), небольшие.
- `G.quality = { level: 'low'|'medium'|'high', pixelRatio }`, событие `quality:changed` — уважайте уровень.

## Соглашения

- Единицы СИ: метры, секунды, м/с, кг, радианы. Для показа: км/ч = м/с × 3.6.
- Оси: **Y вверх, север = −Z, восток = +X**. Курс `heading` — радианы, 0 = север, по часовой стрелке (восток = π/2). Вектор курса: `(sin h, 0, −cos h)` (`headingVec` в `core/util.js`).
- Модель самолёта: **нос −Z, правое крыло +X, верх +Y**, начало координат в центре тяжести, реальный масштаб.
- Мир: квадрат 64×64 км с центром в (0,0), уровень моря y = 0.

## Контекст `G` (`src/core/game.js`)

```
G.canvas, G.ui (корневой div для DOM-интерфейса), G.renderer, G.scene, G.camera (PerspectiveCamera)
G.bus            — шина событий: on(type, fn) -> отписка, off, emit(type, payload)
G.profile        — профиль игрока (см. core/save.js: money, xp, owned[], selectedPlane, upgrades, missions, stats, settings, ...)
G.mode           — 'menu' | 'flight' | 'debrief';  G.paused
G.time           — { now (реальное, с), sim (игровое, с), scale (ускорение времени 1|2|4), fps }
G.quality        — { level, pixelRatio }
G.aircraft[]     — все самолёты (игрок + ИИ);  G.player — самолёт игрока или null
G.flight         — { session, time, distance, maxAlt, maxSpeed, touchdowns[], takeoffs }
G.world, G.input, G.cameraRig, G.hud, G.menu, G.career, G.missions, G.combat, G.ai, G.fx, G.audio

G.spawnAircraft(specId, { team, isPlayer, x, y, z, heading, speed, onGround, livery }) -> ac   (создаёт сущность + модель, добавляет в сцену)
G.removeAircraft(ac)
G.startFlight(session)   session = { planeId?, missionId?, airportId?, runway? (индекс), end? ('A'|'B'),
                                     air?: {x,y,z,heading,speed}, timeOfDay?, weather?, livery?, loadout? }
G.endFlight(result)      result = { reason: 'quit'|'crashed'|'landed'|'mission_complete'|'mission_failed',
                                    success?, missionId?, title?, text?, stars? (0..3), reward?: {money, xp}, details? }
                         ядро добавляет result.session, result.planeId, result.stats {time, distance, maxAlt, maxSpeed, touchdowns, takeoffs}
G.toMenu()               — убрать полёт и показать меню
G.setPaused(bool)
G.setQuality('low'|'medium'|'high'|'auto')
```

Порядок шага симуляции (фиксированный dt = 1/60): `input.update → input.apply(player) → missions.update → ai.update → физика всех G.aircraft → combat.update`.
Порядок кадра: `world.update → синхронизация моделей + animateModel → fx.update → cameraRig.update → hud.update → audio.update → render`.
В меню (`G.mode === 'menu'`) мир продолжает жить (фон меню — живой 3D-мир), камеру ведёт `cameraRig`.

## Сущность самолёта `ac` (`src/aircraft/physics.js`)

```
id, specId, spec (запись каталога), aero (выведенные коэффициенты)
team: 'player' | 'friend' | 'enemy' | 'neutral';  isPlayer
pos: Vector3, vel: Vector3 (мировая, м/с), quat: Quaternion, angVel: Vector3 (связанные оси: x тангаж нос вверх +, y рыскание нос влево +, z крен влево +)
controls: { pitch, roll, yaw: −1..1 (pitch + = нос вверх, roll + = вправо, yaw + = нос вправо), throttle 0..1, brake 0..1, airbrake 0..1 }
throttle (фактическая тяга 0..1), gearDown (bool, команда), gearPos 0..1, flaps (команда 0|0.5|1), flapsPos 0..1, airbrake 0..1
engineOn, fuel, fuelMax (кг), mass, hp 0..100, alive, crashed
onGround, onWater, stalled
ias, tas (м/с), alt (над морем), agl (над поверхностью), vs (верт. скорость), heading 0..2π, pitch, bank (+ вправо), aoa, slip, g (перегрузка), mach
surface: 'air' | 'runway' | 'ground' | 'water' | 'carrier' | 'apron';  airport (объект аэродрома под колёсами или null)
model: THREE.Group;  weapons (владелец — combat);  ai (владелец — ai);  mods: { thrust, drag, agility } (множители улучшений)
```

Каталог: `src/aircraft/catalog.js` — `CATALOG`, `getSpec(id)`. id самолётов стабильны: `yak52, an2, l410, yak40, tu154, il76, be200, l39, mig21, su25, mig29, su27` (позже добавятся ещё).

## События шины

| Событие | Данные | Кто шлёт |
|---|---|---|
| `flight:start` | `{session, ac}` | ядро |
| `flight:end` | `{result}` | ядро |
| `menu:show` | — | ядро |
| `pause` | `{paused}` | ядро |
| `resize` | `{w, h}` | ядро |
| `quality:changed` | `G.quality` | ядро |
| `ac:spawn`, `ac:remove` | `{ac}` | ядро |
| `ac:touchdown` | `{ac, vs, speed, surface, airport, runway, across, along}` | физика |
| `ac:takeoff` | `{ac}` | физика |
| `ac:stall` | `{ac}` | физика |
| `ac:crash` | `{ac, reason}` — reason: `water, hard, wing, nose, gearup, terrain, shot, collision, fuel` | физика / бой |
| `ac:damage` | `{ac, amount, source}` | бой |
| `ac:destroyed` | `{ac, by}` — самолёт сбит | бой |
| `target:destroyed` | `{target, by}` — наземная/морская цель | бой |
| `weapon:fire` | `{ac, weapon}` | бой |
| `input:gear`, `input:flaps {dir}`, `input:camera`, `input:pause`, `input:weapon`, `input:map`, `input:timescale` | разовые действия игрока | ввод / HUD |
| `ui:toast` | `{text, kind: 'info'|'good'|'warn'|'bad'}` | любой |
| `radio` | `{from, text}` — радиообмен субтитрами («Вышка», «Ведомый») | миссии и др. |
| `mission:objective` | `{text, index, total}` | миссии |
| `mission:complete` / `mission:fail` | `{missionId, ...}` | миссии |
| `career:changed` | — (деньги, опыт, покупки) | карьера |
| `settings:changed` | — | меню |

Если ядро само завершает полёт после аварии игрока (через ~3 с после `ac:crash`), результат — `{reason: 'crashed', crashReason}`.

## Контракты модулей

### Мир — `src/world/*` (`createWorld(G)` → `G.world`)
```
size (64000), group (THREE.Group всего мира)
airports[] / airportById — см. world/layout.js: { id, name, code, kind: 'intl'|'military'|'regional'|'strip'|'carrier', x, z, elevation, runways: [{ name, heading, length, width, cx, cz }] }
pois[] / poiById — ориентиры: { id, name, kind, x, z }
heightAt(x, z) -> высота рельефа (под водой отрицательная)
groundAt(x, z) -> { y, surface: 'water'|'ground'|'runway'|'apron'|'carrier', airport?, runway?, along?, across? }   — быстрая: зовётся для каждого самолёта каждый шаг
runwayLocal(rw, x, z) -> { along, across }  (along — вдоль полосы от центра в сторону курса heading)
runwayStart(airportId, rwIndex = 0, end = 'A') -> { x, y, z, heading, airport, runway }  — исполнительный старт
nearestAirport(x, z) -> { airport, dist }
wind: Vector3 (м/с, куда дует), sunDir: Vector3 (на солнце)
timeOfDay (часы 0..24), setTimeOfDay(h);  weather: { type: 'clear'|'cloudy'|'overcast'|'rain'|'storm'|'fog'|'snow', visibility (м), cloudBase (м), turbulence 0..1, rain 0..1 }, setWeather(type)
update(dt)
```
id аэродромов (стабильны): `yasny, kamenny, gavan, gnezdo, mayak, polyarny, yuzhny, carrier`. id ориентиров — в `layout.js`.

### Модели — `src/aircraft/models*.js`, `src/aircraft/models/*`
`buildModel(specId, { livery?, team? }) -> THREE.Group`; `animateModel(model, ac, dt)` (винты, шасси, закрылки, рули, форсаж, огни); для ангара — тот же `buildModel` (должна хорошо выглядеть вблизи).

### Ввод — `src/systems/input.js` (`G.input`)
`state { pitch, roll, yaw, throttle, brake, airbrake, fire, fireAlt }`, `update(dt)`, `apply(ac)`, `reset()`, `setThrottle(v)`. Разовые действия — события `input:*`. Сенсорные элементы управления — тоже здесь (DOM в `G.ui`).

### Камера — `src/systems/camera.js` (`G.cameraRig`)
`mode`, `next()`, `snap()`, `update(dtReal)`; в меню показывает красивые виды мира; в ангаре меню может вызвать `G.cameraRig.setHangar(target|null)` (если реализовано).

### HUD — `src/ui/hud.js` (`G.hud`)
`show()`, `hide()`, `setObjective(text|null)`, `setMarkers([{ x, y, z, label, kind: 'waypoint'|'target'|'friend'|'airport'|'ring', radius? }])`, `toast(text, kind)`, `radio(from, text)`, `update(dtReal)`.

### Меню — `src/ui/menu*.js` (`G.menu`)
`show(screen)`, `hide()`, `showDebrief(result)`. Слушает `menu:show`, `pause`, `flight:end`, `flight:start`.

### Карьера — `src/systems/career.js`, `src/systems/economy.js` (`G.career`)
`rank() -> {index, name, xp, nextXp}`, `owns(id)`, `canBuy(id) -> {ok, reason}`, `buy(id)`, `select(id)`, `addReward({money, xp})`, `planeMods(id) -> {thrust, drag, agility}`, `changed()`.

### Миссии — `src/missions/*` (`G.missions`)
`list[]` (описания: `{ id, title, category: 'training'|'civil'|'cargo'|'rescue'|'combat'|'special', brief, plane?, reward: {money, xp}, requires? }`), `byId`, `flightParams(id) -> session`, `start(id)`, `stop()`, `update(dt)`, `active`. Миссия завершает полёт через `G.endFlight({reason:'mission_complete', success:true, stars, reward, ...})`.

### Бой — `src/systems/combat.js` (`G.combat`)
`armAircraft(ac, loadout?)`, `targets[]` (наземные/морские цели `{ id, kind, pos, hp, alive, team }`), `spawnGroundTarget({ kind, x, z, heading?, team?, hp?, route? }) -> target`, `damage(entity, amount, source)`, `playerTarget`, `clear()`, `update(dt)`.

### ИИ — `src/systems/ai.js` (`G.ai`)
`spawn({ specId, team, x, y, z, heading, speed, behavior: 'patrol'|'attack'|'escort'|'route'|'land'|'flee'|'orbit', route?, target?, skill? 0..1 }) -> ac`, `remove(ac)`, `clear()`, `update(dt)` — ИИ пишет в `ac.controls`.

### Эффекты — `src/systems/fx.js` (`G.fx`)
`explosion(pos, size)`, `smokePuff(pos, opts)`, `splash(pos, size)`, `dust(pos, size)`, `tracer(from, to, opts)`, `fire(pos, size) -> {stop()}`, `waterDrop(pos, vel, amount)`, `clear()`, `update(dt)`.

### Звук — `src/systems/audio.js` (`G.audio`)
`unlock()` (из первого жеста), `play(name, opts)`, `setVolume(sound, music)`, `update(dtReal)`. Только WebAudio-синтез, без файлов.

## Интерфейс: дизайн-токены и правила

- Токены — в `src/ui/base.css` (`--night`, `--cream`, `--dawn`, `--sky`, `--signal`, `--ok`, `--glass`, шрифты `--f-display` Oswald / `--f-body` Golos Text / `--f-mono` JetBrains Mono, безопасные зоны `--sa-t/--sa-b/--sa-l/--sa-r`). Все цвета интерфейса — только через токены. Нужен новый токен — заведите его в своём CSS-файле в `:root` с понятным именем.
- Образ: ночное небо + рассветный оранжевый акцент + кремовые шкалы приборов. Заголовки — Oswald, прописные, с разрядкой, как трафаретные надписи на борту. Цифры приборов — моноширинные. Панели — «стекло» (`--glass`) поверх живого 3D. Без эмодзи. Иконки — простые встроенные SVG.
- Слой интерфейса: каждый модуль добавляет в `G.ui` свой корневой элемент (он растягивается на весь экран, `pointer-events: none`); интерактивным элементам включайте `pointer-events: auto`.
- Сенсор: цели касания не меньше 44×44 px, важные кнопки в полёте 56+ px и под большими пальцами. Учитывайте безопасные зоны (`var(--sa-*)`). Никакого hover-only.
- Основной экран — телефон в альбомной ориентации (≈ 844×390 … 932×430), затем планшет (≈ 1180×820). Портрет не должен ломаться (меню прокручивается, HUD ужимается).
- CSS каждого модуля — в своём файле `src/ui/<модуль>.css` (сборка сама склеит все `src/**/*.css`). Имена классов — с префиксом модуля (`hud-`, `menu-`, `touch-`…).

## Уточнения контрактов (обязательны для всех)

**Якоря модели.** `buildModel` кладёт в `model.userData.anchors` точки в локальных координатах модели (Vector3):
`cockpit` (глаза пилота — для вида из кабины), `engines[]` (сопла/выхлоп — для дыма, форсажа, инверсионного следа), `props[]` (центры винтов), `muzzles[]` (стволы пушек), `hardpoints[]` (точки подвески), `wingtips[]` ([левая, правая] законцовки), `gearMain[]`, `gearNose` (колёса — для пыли/дыма касания). Пользователи якорей обязаны иметь запасной вариант, если якоря нет.
Ливреи: `src/aircraft/models.js` экспортирует `LIVERIES` — `{ [specId]: [{ id, name }] }` (первая — по умолчанию). Импортируйте чужие необязательные экспорты через `import * as M from ...` и проверяйте наличие — иначе сборка упадёт, пока сосед не дописал.

**Вооружение.** `ac.weapons` (ставит `combat.armAircraft`; у гражданских — `null` либо только спецсредства):
```
{ gun: { ammo, max, firing } | null,
  slots: [{ id, name, type: 'aam'|'rocket'|'bomb'|'water'|'cargo'|'flare', count, max }],
  selected: индекс в slots,
  lock: { target, progress 0..1, locked } | null }
```
`input.state.fire` — пушка (удержание), `input.state.fireAlt` — выбранный слот (пуск ракеты / сброс бомбы, воды, груза). `input:weapon` — следующий слот.

**Контекстное действие.** `G.hud.setAction({ id, label } | null)` — показать большую кнопку действия задания («Сбросить груз», «Выпустить спасательный плот»); нажатие шлёт `input:action { id }`.

**Камера-витрина (ангар).** `G.cameraRig.setShowcase({ x, y, z, radius } | null)` — в режиме меню камера плавно облетает точку; `G.cameraRig.showcaseRotate(dYaw, dPitch)` — поворот пальцем (зовёт меню из своих обработчиков). Меню само ставит показываемый самолёт (`buildModel`) в сцену и убирает его.

**Награды платит только карьера.** Миссии и ядро не трогают `profile.money/xp`. Карьера слушает `flight:end` и по `result` (в т.ч. `result.reward`, `result.stars`, `result.stats`) начисляет деньги/опыт, записывает звёзды задания, статистику, журнал, достижения. Перед показом итогов карьера дописывает в `result.payout = { money, xp, lines: [{ label, money?, xp? }], rankUp?: {name}, achievements?: [...] }` — меню показывает это в разборе полёта. (Карьера создаётся раньше меню, поэтому её обработчик `flight:end` срабатывает первым.)

**Описание задания** (`G.missions.list[]`): `{ id, title, category, brief, plane? (жёстко заданный id), planes? (разрешённые id), cls? (разрешённые классы), reward: { money, xp }, requires?: { rank?: индекс звания, missions?: [id] }, difficulty: 1..5, order, from?: id аэродрома, to?: id аэродрома }`. Доступность и звёзды: `G.career.missionState(id) -> { unlocked, reason, stars, done }`.

**Свободный полёт** — `G.startFlight({ planeId, airportId | air, timeOfDay, weather })` без `missionId`. Завершение — из паузы («Завершить полёт») → `G.endFlight({ reason: 'quit' | 'landed' })`.

## Дополнения (второй этап)

**Персонализация.** Игра — подарок Дмитрию Копленко от сына Алексея. Позывной игрока — `G.profile.callsign` («Корвет»): в радиообмене обращаться по позывному («Тирасполь-Вышка: Корвет, взлёт разрешаю»). Семейная фраза «Три-хо-хо!» — изредка, как похвала за удачу. Места: `yasny` = Тирасполь (родной город), `gavan` = Бендеры (за «мостом через Днестр», ориентир `bridge`), `polyarny` = Москва, `yuzhny` = Париж, ориентир `resort` = Бри-Конт-Робер. id не менялись — названия всегда бери из `world.airportById[id].name` / `world.poiById[id].name`, не константами.

**Пилотаж — `src/systems/aerobatics.js`, `src/ui/aerobatics.css` (`G.aerobatics`).** Распознаёт фигуры игрока в любом полёте и шлёт событие `trick:done { id, name, score, ac }`. id фигур: `roll` (бочка), `loop` (мёртвая петля), `immelmann` (полупетля с полубочкой), `splits` (переворот), `chandelle` (боевой разворот), `turn360` (вираж), `inverted` (перевёрнутый полёт), `lowpass` (бреющий проход), `knife` (полёт на ноже), `hammerhead` (поворот на горке) — список можно расширять. Поля: `score` (очки за полёт), `done[]`. Ядро зовёт `G.aerobatics.update(dt)` каждый шаг симуляции.

**Бой (упрощённый, аркадный) — `src/systems/combat.js`, `src/systems/ai-combat.js`.** Владелец — ведущий. API по разделам «Вооружение», «Бой», «ИИ». Противник — `G.ai.spawn({ specId, team: 'enemy', x, y, z, heading, speed, behavior: 'attack', skill })`; цели — `G.combat.spawnGroundTarget({ kind, x, z, y?, heading?, team?, hp? })` → `{ id, kind, pos, vel, hp, alive, team }`; уничтожение для тестов — `G.combat.damage(entity, 9999, G.player)`; события `ac:destroyed { ac, by }`, `target:destroyed { target, by }`.

**Вода и груз в заданиях** не зависят от боя: задание само показывает кнопку через `G.hud.setAction` и рисует сброс через `G.fx.waterDrop` / свою модель груза.

## Дополнения (третий этап)

Отзыв заказчика после игры: «непонятно, что делать»; жёлтый кружок-маркер непонятен; инструкция быстро пропадает; застрял на боевом развороте в «Школе пилотажа»; хочется больше похожести на авиасимулятор (но без сложности для папы) и более красивого мира. Самолёты и звук нравятся.

**Материалы.** Самолёты теперь `MeshStandardMaterial` с гладкими нормалями и отражением неба (исключение из правила «Lambert + flatShading»). Мир может уходить от гранёного стиля к более реалистичному, если это красиво и укладывается в бюджет телефона Galaxy S23.

**Режим «Открыть всё».** `G.profile.settings.unlockAll` (по умолчанию включён): `career.owns()` и `career.missionState()` считают всё доступным.

**Автопилот и навигация — `src/systems/autoflight.js`, `src/ui/autoflight.css` (`G.autoflight`).** Ядро зовёт `G.autoflight.update(dt)` каждый шаг симуляции сразу после ручного ввода (`input.apply`) — модуль пишет в `G.player.controls` поверх ввода, когда включён. Поля: `active`, `mode`, `destination`. Методы: `engage(mode, opts)`, `disengage()`, `setDestination(airportId | null)`.

**Старт со стоянки.** `G.startFlight({ ..., airportId, parking: true | индекс })` ставит самолёт на `airport.parking[i]`.
