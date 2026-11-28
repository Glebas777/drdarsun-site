const book = document.querySelector('[data-oils-book]');

if (book) {
    const stage = book.querySelector('[data-book-stage]');
    const pages = [...book.querySelectorAll('[data-book-page]')];
    const pageButtons = [...book.querySelectorAll('.oils-book__dots [data-book-go]')];
    const jumpButtons = [...book.querySelectorAll('[data-book-go]')].filter(button => !button.closest('.oils-book__dots'));
    const previousButton = book.querySelector('[data-book-prev]');
    const nextButton = book.querySelector('[data-book-next]');
    const counter = book.querySelector('[data-book-counter]');
    const progress = book.querySelector('[data-book-progress]');
    let activePage = 0;
    let touchStart;

    function showPage(index) {
        activePage = Math.max(0, Math.min(index, pages.length - 1));

        pages.forEach((page, pageIndex) => {
            const isActive = pageIndex === activePage;
            page.hidden = !isActive;
            page.setAttribute('aria-hidden', String(!isActive));
            page.classList.toggle('is-entering', isActive);
        });

        pageButtons.forEach(button => {
            const isActive = Number(button.dataset.bookGo) === activePage;
            if (isActive) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });

        if (previousButton) previousButton.disabled = activePage === 0;
        if (nextButton) nextButton.disabled = activePage === pages.length - 1;
        if (counter) {
            counter.textContent = `${activePage + 1} / ${pages.length}`;
            counter.setAttribute('aria-label', `Страница ${activePage + 1} из ${pages.length}: ${pages[activePage].dataset.pageTitle}`);
        }
        if (progress) progress.style.width = `${((activePage + 1) / pages.length) * 100}%`;
    }

    [...pageButtons, ...jumpButtons].forEach(button => {
        button.addEventListener('click', () => showPage(Number(button.dataset.bookGo)));
    });

    previousButton?.addEventListener('click', () => showPage(activePage - 1));
    nextButton?.addEventListener('click', () => showPage(activePage + 1));

    stage?.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showPage(activePage - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showPage(activePage + 1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            showPage(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            showPage(pages.length - 1);
        }
    });

    stage?.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch' && !event.target.closest('a, button')) {
            touchStart = { x: event.clientX, y: event.clientY };
        }
    });

    stage?.addEventListener('pointerup', event => {
        if (!touchStart || event.pointerType !== 'touch') return;
        if (event.target.closest('a, button')) {
            touchStart = undefined;
            return;
        }
        const deltaX = event.clientX - touchStart.x;
        const deltaY = event.clientY - touchStart.y;
        touchStart = undefined;

        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;
        showPage(activePage + (deltaX < 0 ? 1 : -1));
    });

    stage?.addEventListener('pointercancel', () => {
        touchStart = undefined;
    });

    showPage(activePage);
}
