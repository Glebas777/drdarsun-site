import { supabase } from './supabase-client.js';
let all = [];
async function load() {
    const { data } = await supabase.from('products').select('*');
    all = data || [];
    render(all);
}
function render(prods) {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    grid.innerHTML = prods.map(p => `
        <div class="product-card" onclick="window.location.href='product.html?id=${p.id}'">
            <div class="product-card__img"><img src="${p.image_url || 'assets/images/logo.png'}"></div>
            <div class="product-card__info">
                <h3>${p.name}</h3>
                <div class="product-card__price">${p.price} ₽</div>
            </div>
        </div>
    `).join('');
}
document.querySelector('.search-bar')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    render(all.filter(p => p.name.toLowerCase().includes(q)));
});
document.getElementById('bot-toggle')?.addEventListener('click', () => document.getElementById('bot-modal').style.display = 'flex');
document.getElementById('bot-close')?.addEventListener('click', () => document.getElementById('bot-modal').style.display = 'none');
document.querySelectorAll('.bot-opt').forEach(b => {
    b.addEventListener('click', () => {
        const m = document.getElementById('bot-messages');
        m.innerHTML += `<div class="bot-msg user">${b.dataset.msg}</div>`;
        setTimeout(() => {
            m.innerHTML += `<div class="bot-msg">Секунду, передаю Доктору!</div>`;
            m.scrollTop = m.scrollHeight;
        }, 500);
    });
});
// Фильтрация по чекбоксам
document.querySelectorAll('.filters-sidebar input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
        const active = Array.from(document.querySelectorAll('.filters-sidebar input[type="checkbox"]:checked'))
            .map(c => c.parentElement.textContent.trim().toLowerCase());
        if (active.length === 0) { render(all); return; }
        const filtered = all.filter(p => {
            const name = (p.name || '').toLowerCase();
            return active.some(a => name.includes(a.split(' ')[0]));
        });
        render(filtered);
    });
});
load();

