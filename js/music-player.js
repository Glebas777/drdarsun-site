(() => {
    const scriptUrl = document.currentScript?.src || new URL('./js/music-player.js', window.location.href).href;
    const styleUrl = new URL('../css/music-player.css', scriptUrl);
    if (!document.querySelector(`link[href="${styleUrl.href}"]`)) {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = styleUrl.href;
        document.head.appendChild(stylesheet);
    }

    const tracks = [
        { title: 'I’m glad you are here with me', artist: 'Loyalty Freak Music', file: 'lofi-ambient.mp3', accent: 'gold' },
        { title: 'Aeroplane', artist: 'Loyalty Freak Music', file: 'aeroplane.mp3', accent: 'green' },
        { title: 'Sugar and Coffee', artist: 'Loyalty Freak Music', file: 'sugar-and-coffee.mp3', accent: 'coral' },
        { title: 'Crying Those Tears', artist: 'Loyalty Freak Music', file: 'crying-tears.mp3', accent: 'blue' }
    ];

    const trackIndexKey = 'drdarsun-music-track-v1';
    const stateKey = 'drdarsun-music-state-v1';
    const volumeKey = 'drdarsun-music-volume-v1';
    let trackIndex = 0;
    let shouldResume = false;
    const miniHiddenKey = 'drdarsun-music-mini-hidden-v1';

    try {
        trackIndex = Math.max(0, Math.min(tracks.length - 1, Number(sessionStorage.getItem(trackIndexKey) || 0)));
    } catch (error) {
        console.warn('Music track preference is unavailable:', error);
    }

    const toggle = document.createElement('button');
    toggle.className = 'music-player__toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Открыть плеер');
    toggle.setAttribute('aria-haspopup', 'dialog');
    toggle.innerHTML = '<span class="music-player__toggle-disc" aria-hidden="true">♫</span><span class="music-player__toggle-copy"><small>СЕЙЧАС ИГРАЕТ</small><strong>Плеер</strong></span>';

    const mini = document.createElement('section');
    mini.className = 'music-player';
    mini.setAttribute('aria-label', 'Мини плеер');
    mini.innerHTML = `
        <button class="music-player__mini-cover" type="button" aria-label="Открыть плеер"><span aria-hidden="true">♫</span></button>
        <div class="music-player__mini-copy">
            <span>DR. DARSUN</span>
            <strong class="music-player__mini-title"></strong>
            <small class="music-player__mini-artist"></small>
            <input class="music-player__seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Позиция воспроизведения">
        </div>
        <div class="music-player__mini-controls">
            <button class="music-player__prev" type="button" aria-label="Предыдущий трек">‹</button>
            <button class="music-player__play" type="button" aria-label="Воспроизвести">▶</button>
            <button class="music-player__next" type="button" aria-label="Следующий трек">›</button>
        </div>
        <button class="music-player__mini-hide" type="button" aria-label="Скрыть мини плеер"><span aria-hidden="true">×</span></button>`;

    const modal = document.createElement('section');
    modal.className = 'music-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Музыкальный плеер');
    modal.setAttribute('aria-hidden', 'true');
    modal.hidden = true;

    const audio = document.createElement('audio');
    audio.className = 'music-player__audio';
    audio.loop = false;
    audio.preload = 'metadata';

    function formatTime(seconds) {
        if (!Number.isFinite(seconds)) return '0:00';
        const minutes = Math.floor(seconds / 60);
        return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    }

    function saveState() {
        try {
            sessionStorage.setItem(trackIndexKey, String(trackIndex));
            sessionStorage.setItem(stateKey, JSON.stringify({
                currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
                playing: shouldResume || (!audio.paused && !audio.ended)
            }));
        } catch (error) {
            console.warn('Music player state could not be saved:', error);
        }
    }

    function syncTrack({ preserveTime = false } = {}) {
        const track = tracks[trackIndex];
        const wasPlaying = !audio.paused && !audio.ended;
        audio.src = new URL(`../music/${track.file}`, scriptUrl).href;
        mini.dataset.accent = track.accent;
        modal.dataset.accent = track.accent;
        mini.querySelector('.music-player__mini-title').textContent = track.title;
        mini.querySelector('.music-player__mini-artist').textContent = track.artist;
        toggle.querySelector('strong').textContent = track.title;
        modal.querySelectorAll('[data-track-title]').forEach(element => { element.textContent = track.title; });
        modal.querySelectorAll('[data-track-artist]').forEach(element => { element.textContent = track.artist; });
        modal.querySelectorAll('.music-modal__track').forEach((element, index) => element.classList.toggle('is-active', index === trackIndex));
        if (!preserveTime) saveState();
        if (wasPlaying || shouldResume) audio.play().catch(() => {});
    }

    function updatePlayback() {
        const isPlaying = !audio.paused && !audio.ended;
        mini.dataset.playing = String(isPlaying);
        modal.dataset.playing = String(isPlaying);
        mini.querySelector('.music-player__play').textContent = isPlaying ? 'Ⅱ' : '▶';
        modal.querySelector('.music-modal__play').textContent = isPlaying ? 'Ⅱ' : '▶';
        mini.querySelector('.music-player__play').setAttribute('aria-label', isPlaying ? 'Приостановить' : 'Воспроизвести');
        modal.querySelector('.music-modal__play').setAttribute('aria-label', isPlaying ? 'Приостановить' : 'Воспроизвести');
    }

    function updateProgress() {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const value = duration > 0 ? Math.round(audio.currentTime / duration * 1000) : 0;
        mini.querySelector('.music-player__seek').value = String(value);
        modal.querySelector('.music-modal__seek').value = String(value);
        modal.querySelector('.music-modal__time').textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
        saveState();
    }

    async function togglePlayback() {
        if (audio.paused) {
            try {
                await audio.play();
                shouldResume = true;
            } catch {
                modal.querySelector('.music-modal__status').textContent = 'Нажмите для продолжения';
            }
        } else {
            audio.pause();
            shouldResume = false;
        }
        updatePlayback();
        saveState();
    }

    function changeTrack(direction) {
        trackIndex = (trackIndex + direction + tracks.length) % tracks.length;
        syncTrack();
    }

    function setSeek(value) {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        audio.currentTime = Number(value) / 1000 * audio.duration;
        updateProgress();
    }

    function setModalOpen(open) {
        modal.hidden = !open;
        modal.setAttribute('aria-hidden', String(!open));
        document.body.classList.toggle('music-modal-open', open);
        if (open) {
            modal.querySelector('.music-modal__close').focus({ preventScroll: true });
        } else {
            audio.pause();
            shouldResume = false;
            saveState();
            updatePlayback();
            toggle.focus({ preventScroll: true });
        }
    }

    modal.innerHTML = `
        <div class="music-modal__backdrop"></div>
        <div class="music-modal__panel">
            <header class="music-modal__header">
                <div><span>DR. DARSUN</span><strong>Музыкальная комната</strong></div>
                <button class="music-modal__close" type="button" aria-label="Закрыть плеер">×</button>
            </header>
            <div class="music-modal__body">
                <section class="music-modal__now">
                    <div class="music-modal__cover" aria-hidden="true"><span>♫</span><i></i><i></i><i></i></div>
                    <div class="music-modal__meta"><span>СЕЙЧАС ИГРАЕТ</span><h2 data-track-title></h2><p data-track-artist></p></div>
                    <input class="music-modal__seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Позиция воспроизведения">
                    <div class="music-modal__timeline"><span class="music-modal__time">0:00 / 0:00</span><span class="music-modal__status" role="status" aria-live="polite"></span></div>
                    <div class="music-modal__controls">
                        <button class="music-modal__prev" type="button" aria-label="Предыдущий трек">‹</button>
                        <button class="music-modal__play" type="button" aria-label="Воспроизвести">▶</button>
                        <button class="music-modal__next" type="button" aria-label="Следующий трек">›</button>
                        <div class="music-modal__volume"><span>Громкость</span><input type="range" min="0" max="1" value="0.65" step="0.05" aria-label="Громкость"></div>
                    </div>
                    <div class="music-modal__actions">
                        <a class="music-modal__credit" href="https://archive.org/details/lofi-ambient-songs" target="_blank" rel="noopener noreferrer">Музыка Loyalty Freak Music · CC0</a>
                        <button class="music-modal__mini-toggle" type="button">Скрыть мини плеер</button>
                    </div>
                </section>
                <aside class="music-modal__playlist"><span class="music-modal__playlist-label">ПЛЕЙЛИСТ</span>${tracks.map((track, index) => `<button class="music-modal__track" type="button" data-track-index="${index}"><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${track.title}</strong><small>${track.artist}</small></div></button>`).join('')}</aside>
            </div>
        </div>`;

    document.body.appendChild(toggle);
    document.body.appendChild(mini);
    document.body.appendChild(modal);
    document.body.appendChild(audio);
    document.body.classList.add('has-music-player');

    try {
        const miniHidden = localStorage.getItem(miniHiddenKey) === 'true';
        setMiniHidden(miniHidden);
        const saved = JSON.parse(sessionStorage.getItem(stateKey) || '{}');
        audio.volume = Number(localStorage.getItem(volumeKey) ?? 0.65);
        modal.querySelector('.music-modal__volume input').value = String(audio.volume);
        syncTrack({ preserveTime: true });
        audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(saved.currentTime) && saved.currentTime > 0 && saved.currentTime < audio.duration) audio.currentTime = saved.currentTime;
            updateProgress();
            if (saved.playing) {
                shouldResume = true;
                audio.play().then(updatePlayback).catch(() => {
                    modal.querySelector('.music-modal__status').textContent = 'Нажмите для продолжения';
                });
            }
        }, { once: true });
    } catch (error) {
        console.warn('Music state is unavailable:', error);
        syncTrack();
    }

    toggle.addEventListener('click', () => setModalOpen(true));
    mini.querySelector('.music-player__mini-cover').addEventListener('click', () => setModalOpen(true));
    modal.querySelector('.music-modal__backdrop').addEventListener('click', () => setModalOpen(false));
    modal.querySelector('.music-modal__close').addEventListener('click', () => setModalOpen(false));
    mini.querySelector('.music-player__play').addEventListener('click', togglePlayback);
    modal.querySelector('.music-modal__play').addEventListener('click', togglePlayback);
    mini.querySelector('.music-player__prev').addEventListener('click', () => changeTrack(-1));
    modal.querySelector('.music-modal__prev').addEventListener('click', () => changeTrack(-1));
    mini.querySelector('.music-player__next').addEventListener('click', () => changeTrack(1));

    function setMiniHidden(hidden) {
        mini.classList.toggle('is-hidden', hidden);
        mini.dataset.hidden = String(hidden);
        try { localStorage.setItem(miniHiddenKey, String(hidden)); } catch (error) { console.warn('Mini player preference unavailable:', error); }
        const button = modal.querySelector('.music-modal__mini-toggle');
        if (button) button.textContent = hidden ? 'Показать мини плеер' : 'Скрыть мини плеер';
    }

    mini.querySelector('.music-player__mini-hide').addEventListener('click', () => setMiniHidden(true));
    modal.querySelector('.music-modal__mini-toggle').addEventListener('click', () => {
        setMiniHidden(!(mini.dataset.hidden === 'true'));
        audio.pause();
        shouldResume = false;
        saveState();
        updatePlayback();
    });
    modal.querySelector('.music-modal__mini-toggle').addEventListener('click', () => {
        audio.pause();
        shouldResume = false;
        saveState();
        updatePlayback();
    });
    modal.querySelector('.music-modal__next').addEventListener('click', () => changeTrack(1));
    mini.querySelector('.music-player__seek').addEventListener('input', event => setSeek(event.target.value));
    modal.querySelector('.music-modal__seek').addEventListener('input', event => setSeek(event.target.value));
    modal.querySelector('.music-modal__volume input').addEventListener('input', event => {
        audio.volume = Number(event.target.value);
        try { localStorage.setItem(volumeKey, String(audio.volume)); } catch (error) { console.warn('Volume preference unavailable:', error); }
    });
    modal.querySelectorAll('.music-modal__track').forEach(button => button.addEventListener('click', () => {
        trackIndex = Number(button.dataset.trackIndex);
        shouldResume = true;
        syncTrack();
    }));

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !modal.hidden) setModalOpen(false);
    });
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('play', updatePlayback);
    audio.addEventListener('pause', updatePlayback);
    audio.addEventListener('ended', () => changeTrack(1));
    audio.addEventListener('error', () => { modal.querySelector('.music-modal__status').textContent = 'Аудио недоступно'; });
    window.addEventListener('pagehide', saveState);

    syncTrack({ preserveTime: true });
})();
