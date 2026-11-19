const OIL_TYPES = [
    { id: 'olive', name: 'Оливковое масло', category: 'Оливковые масла', image_url: 'assets/images/oils/olive.svg' },
    { id: 'peach', name: 'Персиковое масло', category: 'Масла косточек', image_url: 'assets/images/oils/peach.svg' },
    { id: 'sunflower', name: 'Подсолнечное масло', category: 'Семенные масла', image_url: 'assets/images/oils/sunflower.svg' },
    { id: 'almond', name: 'Миндальное масло', category: 'Ореховые масла', image_url: 'assets/images/oils/almond.svg' },
    { id: 'grape', name: 'Масло виноградной косточки', category: 'Масла косточек', image_url: 'assets/images/oils/grape.svg' },
    { id: 'avocado', name: 'Масло авокадо', category: 'Масла плодов', image_url: 'assets/images/oils/avocado.svg' },
    { id: 'jojoba', name: 'Масло жожоба', category: 'Косметические масла', image_url: 'assets/images/oils/jojoba.svg' },
    { id: 'cacao', name: 'Масло какао', category: 'Ореховые масла', image_url: 'assets/images/oils/cacao.svg' },
    { id: 'coconut', name: 'Кокосовое масло', category: 'Ореховые масла', image_url: 'assets/images/oils/coconut.svg' },
    { id: 'wheat', name: 'Масло зародышей пшеницы', category: 'Семенные масла', image_url: 'assets/images/oils/wheat.svg' },
    { id: 'macadamia', name: 'Масло макадамии', category: 'Ореховые масла', image_url: 'assets/images/oils/macadamia.svg' },
    { id: 'walnut', name: 'Масло грецкого ореха', category: 'Ореховые масла', image_url: 'assets/images/oils/walnut.svg' },
    { id: 'pumpkin', name: 'Тыквенное масло', category: 'Семенные масла', image_url: 'assets/images/oils/pumpkin.svg' },
    { id: 'sea-buckthorn', name: 'Облепиховое масло', category: 'Масла плодов', image_url: 'assets/images/oils/sea-buckthorn.svg' }
];

const PACKAGING_TYPES = ['Тёмное стекло', 'Светлое стекло', 'Пищевая ПЭТ-бутылка', 'Банка'];
const PRESSING_TYPES = ['Холодный отжим', 'Первый холодный отжим', 'Рафинированное'];
const SHELF_LIFE_MONTHS = [3, 6, 9, 12, 18, 24];
const VOLUME_OPTIONS = [100, 250, 500, 1000];

module.exports = { OIL_TYPES, PACKAGING_TYPES, PRESSING_TYPES, SHELF_LIFE_MONTHS, VOLUME_OPTIONS };
