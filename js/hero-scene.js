const heroScene = document.querySelector('.hero-scene');

if (heroScene) {
    heroScene.addEventListener('contextmenu', event => event.preventDefault());
    heroScene.addEventListener('dragstart', event => event.preventDefault());
}

const seed = document.querySelector('[data-video-seed]');

if (seed) {
    const eyes = [...seed.querySelectorAll('.video-seed-stage__eye')].map(eye => ({
        frame: eye,
        pupil: eye.querySelector('.video-seed-stage__pupil')
    }));
    const gaze = { x: 0, targetX: 0, frame: 0 };
    let activeExpression = '';
    let expressionTimer = 0;
    let winkLeft = true;

    function applyGaze(x) {
        eyes.forEach(({ frame, pupil }) => {
            const maxX = frame.clientWidth * 0.065;
            pupil.style.setProperty('--pupil-x', `${(x * maxX).toFixed(2)}px`);
            pupil.style.setProperty('--pupil-y', '0px');
        });
    }

    function renderGaze() {
        gaze.frame = 0;
        gaze.x += (gaze.targetX - gaze.x) * 0.22;

        if (Math.abs(gaze.x - gaze.targetX) < 0.01) {
            gaze.x = gaze.targetX;
        }

        applyGaze(gaze.x);

        if (gaze.x !== gaze.targetX) {
            gaze.frame = requestAnimationFrame(renderGaze);
        }
    }

    function scheduleGaze() {
        if (!gaze.frame) {
            gaze.frame = requestAnimationFrame(renderGaze);
        }
    }

    function setGaze(direction) {
        gaze.targetX = direction;
        scheduleGaze();
    }

    function showExpression(expression, duration) {
        if (activeExpression) return false;
        activeExpression = expression;
        seed.classList.add(expression);
        expressionTimer = window.setTimeout(() => {
            seed.classList.remove(expression);
            activeExpression = '';
        }, duration);
        return true;
    }

    function scheduleBlink() {
        window.setTimeout(() => {
            if (!showExpression('is-blinking', 220)) {
                scheduleBlink();
                return;
            }
            scheduleBlink();
        }, 2600 + Math.random() * 1800);
    }

    function scheduleWink() {
        window.setTimeout(() => {
            const expression = winkLeft ? 'is-winking-left' : 'is-winking-right';
            if (!showExpression(expression, 220)) {
                scheduleWink();
                return;
            }
            winkLeft = !winkLeft;
            scheduleWink();
        }, 10000 + Math.random() * 6000);
    }

    function scheduleLook() {
        const directions = [-1, 0, 1].filter(direction => direction !== gaze.targetX);
        setGaze(directions[Math.floor(Math.random() * directions.length)]);
        window.setTimeout(scheduleLook, 2200 + Math.random() * 1500);
    }

    window.setTimeout(scheduleLook, 900);
    scheduleBlink();
    window.setTimeout(scheduleWink, 8000 + Math.random() * 4000);
}
