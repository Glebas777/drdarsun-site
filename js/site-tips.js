const catalogTip = document.getElementById('catalog-mascot-message');
const catalogTipNext = document.getElementById('catalog-mascot-next');

if (catalogTip && catalogTipNext) {
    const tips = [
        'Начните с поиска по названию или выберите категорию — так найти нужное проще.',
        'Сравнивайте объём, способ отжима и срок хранения в характеристиках товара.',
        'Проверьте назначение и условия хранения на этикетке: они могут различаться у разных масел.'
    ];
    let activeTip = 0;

    catalogTipNext.addEventListener('click', () => {
        activeTip = (activeTip + 1) % tips.length;
        catalogTip.textContent = tips[activeTip];
    });
}

const productTip = document.getElementById('product-mascot-message');
const productTipNext = document.getElementById('product-mascot-next');

if (productTip && productTipNext) {
    const tips = [
        'Сверьте назначение продукта и состав на упаковке: свойства зависят от сырья и обработки.',
        'Условия хранения и срок после вскрытия ищите на этикетке именно этой бутылки.',
        'Для пищевого использования выбирайте только продукт с соответствующей маркировкой.'
    ];
    let activeTip = 0;

    productTipNext.addEventListener('click', () => {
        activeTip = (activeTip + 1) % tips.length;
        productTip.textContent = tips[activeTip];
    });
}
