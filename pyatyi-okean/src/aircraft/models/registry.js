// РЕЕСТР МОДЕЛЕЙ: id каталога -> описание (planes/<id>.js). Самолёт без записи здесь получает запасную модель (planes/generic.js).
// Новый самолёт: файл planes/<id>.js по образцу соседей —
//   export default { id, cgZ (z центра тяжести от носа), groundPitch? (хвостовое колесо), liveries: [{ id, name, paint }], build(b, spec) }
// build рисует конструктором b (kit.js) в чертёжных координатах: X вправо, Y вверх от земли (колёса на y = 0), Z назад от носа;
// симметричные части — внутри b.mirror(() => …). Затем строка импорта и ключ в DEFS ниже.
import yak52 from './planes/yak52.js';
import an2 from './planes/an2.js';
import l410 from './planes/l410.js';
import yak40 from './planes/yak40.js';
import tu154 from './planes/tu154.js';
import il76 from './planes/il76.js';
import be200 from './planes/be200.js';
import l39 from './planes/l39.js';
import mig21 from './planes/mig21.js';
import su25 from './planes/su25.js';
import mig29 from './planes/mig29.js';
import su27 from './planes/su27.js';

export const DEFS = { yak52, an2, l410, yak40, tu154, il76, be200, l39, mig21, su25, mig29, su27 };
