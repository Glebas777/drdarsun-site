const faqItems = [
    { category: 'orders', question: 'Как оформить заказ?', answer: 'Выберите товар в каталоге, укажите нужные параметры и добавьте его в корзину. Затем откройте корзину и заполните данные для оформления.' },
    { category: 'orders', question: 'Можно ли изменить или отменить заказ?', answer: 'Свяжитесь по почте drdarsunhelper@gmail.com как можно быстрее и укажите номер заказа. Изменение возможно до передачи заказа в доставку.' },
    { category: 'orders', question: 'Как посмотреть статус заказа?', answer: 'Откройте профиль и перейдите во вкладку «История заказов». Статус обновляется по мере обработки и доставки.' },
    { category: 'delivery', question: 'Какие способы доставки доступны?', answer: 'Доступные способы и примерные сроки указаны на странице доставки. Конкретная стоимость зависит от региона и способа получения.' },
    { category: 'delivery', question: 'Можно ли отследить посылку?', answer: 'После передачи отправления в службу доставки трек-номер появится в истории заказа или придёт уведомлением.' },
    { category: 'delivery', question: 'Куда обращаться по повреждённой посылке?', answer: 'Сохраните фото упаковки и товара и напишите на drdarsunhelper@gmail.com. Укажите номер заказа и кратко опишите проблему.' },
    { category: 'oils', question: 'Как хранить растительное масло?', answer: 'Храните масло плотно закрытым вдали от света и тепла. Для конкретной партии следуйте сроку и условиям с упаковки.' },
    { category: 'oils', question: 'Где посмотреть состав масла?', answer: 'Страница каждого масла содержит справочную информацию о составе. Лабораторные показатели конкретной партии смотрите на упаковке.' },
    { category: 'oils', question: 'Все ли масла подходят для еды?', answer: 'Нет. Назначение указано на странице и этикетке товара. Косметическое масло не является пищевым продуктом.' },
    { category: 'account', question: 'Как изменить почту или пароль?', answer: 'Войдите в профиль, откройте настройки безопасности или нажмите «Забыли пароль» на странице входа.' },
    { category: 'account', question: 'Как удалить аккаунт?', answer: 'Откройте профиль в раздел «Настройки» и используйте действие удаления аккаунта. Оно удаляет доступ и связанные данные аккаунта.' },
    { category: 'account', question: 'Не пришло письмо подтверждения?', answer: 'Проверьте папку «Спам», дождитесь нескольких минут и запросите новое письмо со страницы входа или профиля.' }
];

const list = document.getElementById('faq-list');
const searchInput = document.getElementById('faq-search-input');
const status = document.getElementById('faq-results-status');
let activeCategory = 'all';

function renderFaq() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = faqItems.filter(item =>
        (activeCategory === 'all' || item.category === activeCategory) &&
        (!query || `${item.question} ${item.answer}`.toLowerCase().includes(query))
    );

    list.replaceChildren();
    status.textContent = filtered.length
        ? `Найдено вопросов: ${filtered.length}`
        : 'По этому запросу вопросов не найдено.';

    if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'faq-empty';
        empty.textContent = 'Попробуйте другое слово или выберите другую категорию.';
        list.appendChild(empty);
        return;
    }

    for (const item of filtered) {
        const details = document.createElement('details');
        details.className = 'faq-item';
        const summary = document.createElement('summary');
        summary.textContent = item.question;
        const answer = document.createElement('div');
        answer.className = 'faq-item__answer';
        const paragraph = document.createElement('p');
        paragraph.textContent = item.answer;
        answer.appendChild(paragraph);
        details.append(summary, answer);
        list.appendChild(details);
    }
}

searchInput.addEventListener('input', renderFaq);
document.querySelectorAll('.faq-category').forEach(button => {
    button.addEventListener('click', () => {
        activeCategory = button.dataset.category;
        document.querySelectorAll('.faq-category').forEach(candidate => candidate.classList.remove('active'));
        button.classList.add('active');
        renderFaq();
    });
});

renderFaq();
