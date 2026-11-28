const searchInput = document.getElementById('oil-search');
const cards = [...document.querySelectorAll('.oil-card')];
const count = document.getElementById('oil-count');
const categoryButtons = [...document.querySelectorAll('[data-encyclopedia-filter]')];
let selectedKind = 'all';

function updateOilCatalog() {
    const query = searchInput?.value.trim().toLocaleLowerCase('ru-RU') ?? '';
    let visible = 0;

    cards.forEach(card => {
        const haystack = `${card.dataset.oil || ''} ${card.textContent || ''}`.toLocaleLowerCase('ru-RU');
        const kind = card.dataset.kind || 'oil';
        const matches = (selectedKind === 'all' || kind === selectedKind) &&
            (!query || haystack.includes(query));
        card.hidden = !matches;
        if (matches) visible += 1;
    });

    if (count) {
        const noun = selectedKind === 'oil' ? 'масел' :
            selectedKind === 'all' ? 'материалов' : 'материалов';
        count.textContent = visible === cards.length && selectedKind === 'all' && !query
            ? `${visible} ${noun}`
            : `Найдено: ${visible}`;
    }
}

searchInput?.addEventListener('input', updateOilCatalog);
categoryButtons.forEach(button => {
    button.addEventListener('click', () => {
        selectedKind = button.dataset.encyclopediaFilter || 'all';
        categoryButtons.forEach(option => {
            option.setAttribute('aria-pressed', String(option === button));
        });
        updateOilCatalog();
    });
});
updateOilCatalog();
