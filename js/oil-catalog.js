const searchInput = document.getElementById('oil-search');
const cards = [...document.querySelectorAll('.oil-card')];
const count = document.getElementById('oil-count');

function updateOilCatalog() {
    const query = searchInput?.value.trim().toLocaleLowerCase('ru-RU') ?? '';
    let visible = 0;

    cards.forEach(card => {
        const haystack = `${card.dataset.oil || ''} ${card.textContent || ''}`.toLocaleLowerCase('ru-RU');
        const matches = !query || haystack.includes(query);
        card.hidden = !matches;
        if (matches) visible += 1;
    });

    if (count) count.textContent = visible === cards.length
        ? `${visible} масел`
        : `Найдено: ${visible}`;
}

searchInput?.addEventListener('input', updateOilCatalog);
updateOilCatalog();
