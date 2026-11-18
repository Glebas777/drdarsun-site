const modal = document.getElementById('snake-modal');
const toggle = document.getElementById('snake-toggle');
const closeButton = document.getElementById('snake-close');
const startButton = document.getElementById('snake-start');
const canvas = document.getElementById('snake-canvas');
const statusMessage = document.getElementById('snake-status');
const scoreLabel = document.getElementById('snake-score');
const bestLabel = document.getElementById('snake-best');

if (modal && toggle && closeButton && startButton && canvas) {
    const context = canvas.getContext('2d');
    const cell = 20;
    const cells = canvas.width / cell;
    let snake = [];
    let direction = { x: 1, y: 0 };
    let nextDirection = direction;
    let food = { x: 0, y: 0 };
    let score = 0;
    let timer;
    let bestScore = 0;
    let gameStarted = false;
    let gamePaused = false;

    try {
        bestScore = Number(localStorage.getItem('drdarsun-snake-best')) || 0;
    } catch (error) {
        console.warn('Snake best score could not be loaded:', error);
    }
    bestLabel.textContent = String(bestScore);

    function colors() {
        const styles = getComputedStyle(document.body);
        return {
            background: styles.getPropertyValue('--bg-color').trim() || '#FAF7E6',
            grid: styles.getPropertyValue('--border').trim() || '#E8DDBB',
            snake: styles.getPropertyValue('--accent-green').trim() || '#1B5E20',
            food: styles.getPropertyValue('--accent-gold').trim() || '#D4AF37'
        };
    }

    function draw() {
        if (!context) return;
        const palette = colors();
        context.fillStyle = palette.background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = palette.grid;
        context.lineWidth = 1;
        for (let position = 0; position <= canvas.width; position += cell) {
            context.beginPath();
            context.moveTo(position, 0);
            context.lineTo(position, canvas.height);
            context.stroke();
            context.beginPath();
            context.moveTo(0, position);
            context.lineTo(canvas.width, position);
            context.stroke();
        }

        context.fillStyle = palette.food;
        context.beginPath();
        context.arc(food.x * cell + cell / 2, food.y * cell + cell / 2, cell * .38, 0, Math.PI * 2);
        context.fill();
        snake.forEach((part, index) => {
            context.fillStyle = palette.snake;
            context.beginPath();
            context.roundRect(part.x * cell + 2, part.y * cell + 2, cell - 4, cell - 4, index ? 5 : 8);
            context.fill();
        });
    }

    function placeFood() {
        do {
            food = { x: Math.floor(Math.random() * cells), y: Math.floor(Math.random() * cells) };
        } while (snake.some(part => part.x === food.x && part.y === food.y));
    }

    function stopGame(message) {
        clearInterval(timer);
        timer = undefined;
        gameStarted = false;
        gamePaused = false;
        statusMessage.textContent = message;
        startButton.textContent = 'Снова';
        if (score > bestScore) {
            bestScore = score;
            bestLabel.textContent = String(bestScore);
            try {
                localStorage.setItem('drdarsun-snake-best', String(bestScore));
            } catch (error) {
                console.warn('Snake best score could not be saved:', error);
            }
        }
    }

    function resumeGame() {
        gamePaused = false;
        statusMessage.textContent = 'Стрелки клавиатуры или кнопки на экране.';
        startButton.textContent = 'Начать заново';
        timer = setInterval(tick, 160);
    }

    function tick() {
        direction = nextDirection;
        const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
        const ateFood = head.x === food.x && head.y === food.y;
        const body = ateFood ? snake : snake.slice(0, -1);
        if (
            head.x < 0 || head.x >= cells || head.y < 0 || head.y >= cells ||
            body.some(part => part.x === head.x && part.y === head.y)
        ) {
            stopGame(`Игра окончена. Счёт: ${score}.`);
            return;
        }
        snake.unshift(head);
        if (ateFood) {
            score += 1;
            scoreLabel.textContent = String(score);
            placeFood();
        } else {
            snake.pop();
        }
        draw();
    }

    function startGame() {
        clearInterval(timer);
        snake = [{ x: 6, y: 8 }, { x: 5, y: 8 }, { x: 4, y: 8 }];
        direction = { x: 1, y: 0 };
        nextDirection = direction;
        score = 0;
        scoreLabel.textContent = '0';
        startButton.textContent = 'Начать заново';
        statusMessage.textContent = 'Стрелки клавиатуры или кнопки на экране.';
        gameStarted = true;
        gamePaused = false;
        placeFood();
        draw();
        timer = setInterval(tick, 160);
    }

    function setDirection(name) {
        const directions = {
            up: { x: 0, y: -1 },
            down: { x: 0, y: 1 },
            left: { x: -1, y: 0 },
            right: { x: 1, y: 0 }
        };
        const chosen = directions[name];
        if (chosen && chosen.x !== -direction.x && chosen.y !== -direction.y) nextDirection = chosen;
    }

    function openGame() {
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('snake-open');
        toggle.setAttribute('aria-expanded', 'true');
        draw();
        if (gamePaused) statusMessage.textContent = 'Пауза. Нажми «Продолжить», чтобы вернуться в игру.';
        startButton.focus();
    }

    function closeGame() {
        const wasRunning = timer !== undefined;
        clearInterval(timer);
        timer = undefined;
        if (wasRunning && gameStarted) {
            gamePaused = true;
            startButton.textContent = 'Продолжить';
            statusMessage.textContent = 'Игра на паузе.';
        }
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('snake-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
    }

    toggle.addEventListener('click', openGame);
    closeButton.addEventListener('click', closeGame);
    startButton.addEventListener('click', () => {
        if (gamePaused) resumeGame();
        else startGame();
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) closeGame();
    });
    modal.querySelectorAll('[data-snake-direction]').forEach(button => {
        button.addEventListener('click', () => setDirection(button.dataset.snakeDirection));
    });
    document.addEventListener('keydown', event => {
        if (modal.hidden) return;
        const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
        if (keys[event.key]) {
            event.preventDefault();
            setDirection(keys[event.key]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeGame();
        } else if (event.key === 'Tab') {
            const focusable = [...modal.querySelectorAll('button:not([disabled])')];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    draw();
}
