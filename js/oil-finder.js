const OIL_SUGGESTIONS = {
    salad: {
        intro: 'Для холодных блюд можно начать с этих страниц справочника:',
        oils: [['olive', 'Оливковое'], ['avocado', 'Авокадо'], ['walnut', 'Грецкий орех']],
        note: 'Пищевое назначение конкретного продукта всегда проверяйте на этикетке.'
    },
    everyday: {
        intro: 'Чтобы сравнить знакомые варианты, загляните сюда:',
        oils: [['sunflower', 'Подсолнечное'], ['olive', 'Оливковое']],
        note: 'Вкус и подходящее применение зависят от вида и обработки конкретного масла.'
    },
    flavor: {
        intro: 'Для начала знакомства с более выраженными вкусовыми профилями:',
        oils: [['pumpkin', 'Тыквенное'], ['walnut', 'Грецкий орех'], ['sea-buckthorn', 'Облепиховое']],
        note: 'Это справочник видов масел, а не список наличия. Сверяйте назначение с этикеткой.'
    },
    care: {
        intro: 'Для косметического ухода изучите эти варианты:',
        oils: [['jojoba', 'Жожоба'], ['peach', 'Персиковое'], ['almond', 'Миндальное']],
        note: 'Косметические масла не предназначены для еды, если пищевое назначение прямо не указано производителем.'
    }
};

const result = document.getElementById('oil-finder-result');

document.querySelectorAll('[data-oil-use]').forEach((button) => {
    button.addEventListener('click', () => {
        const suggestion = OIL_SUGGESTIONS[button.dataset.oilUse];
        if (!suggestion || !result) return;

        result.replaceChildren();
        const intro = document.createElement('p');
        intro.className = 'oil-finder__result-intro';
        intro.textContent = suggestion.intro;
        const links = document.createElement('div');
        links.className = 'oil-finder__result-links';

        suggestion.oils.forEach(([id, name]) => {
            const link = document.createElement('a');
            link.href = `oil-catalog.html#${encodeURIComponent(id)}`;
            link.textContent = name;
            links.appendChild(link);
        });

        const note = document.createElement('p');
        note.className = 'oil-finder__result-note';
        note.textContent = suggestion.note;
        const reset = document.createElement('button');
        reset.className = 'oil-finder__reset';
        reset.type = 'button';
        reset.textContent = 'Выбрать другой вариант';
        reset.addEventListener('click', () => {
            result.hidden = true;
            document.querySelectorAll('[data-oil-use]').forEach(option => option.setAttribute('aria-pressed', 'false'));
            document.querySelector('[data-oil-use]')?.focus();
        }, { once: true });

        result.append(intro, links, note, reset);
        result.hidden = false;
        document.querySelectorAll('[data-oil-use]').forEach(option => {
            option.setAttribute('aria-pressed', String(option === button));
        });
    });
});
