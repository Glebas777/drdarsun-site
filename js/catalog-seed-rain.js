const catalog = canvas?.closest('.catalog-main');

if (canvas instanceof HTMLCanvasElement && catalog) {
    const context = canvas.getContext('2d', { alpha: true });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const seedKinds = [
        { color: '#283a24', highlight: '#a6a878', shape: 0 },
        { color: '#657443', highlight: '#c5c894', shape: 1 },
        { color: '#947045', highlight: '#dfbd80', shape: 2 },
        { color: '#e0cf9a', highlight: '#fff0c8', shape: 3 },
        { color: '#78573d', highlight: '#c49865', shape: 4 },
        { color: '#b88b55', highlight: '#ead0a2', shape: 5 },
        { color: '#4f6342', highlight: '#a8ad75', shape: 6 }
    ];
    const seeds = [];
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frameId = 0;
    let lastTime = 0;
    let spawnElapsed = 0;
    let nextKind = 0;
    let catalogVisible = !('IntersectionObserver' in window);

    function drawSeed(seed) {
        const kind = seedKinds[seed.kind];
        const size = seed.size;
        context.save();
        context.translate(seed.x, seed.y);
        context.rotate(seed.rotation);
        context.globalAlpha = seed.opacity;
        context.fillStyle = kind.color;
        context.strokeStyle = kind.highlight;
        context.lineWidth = Math.max(.55, size * .055);
        context.beginPath();

        if (kind.shape === 0 || kind.shape === 4 || kind.shape === 5) {
            context.moveTo(0, -size);
            context.bezierCurveTo(size * .58, -size * .55, size * .48, size * .55, 0, size);
            context.bezierCurveTo(-size * .48, size * .55, -size * .58, -size * .55, 0, -size);
        } else if (kind.shape === 1 || kind.shape === 6) {
            context.ellipse(0, 0, size * .88, size * .48, 0, 0, Math.PI * 2);
        } else if (kind.shape === 2 || kind.shape === 3) {
            context.moveTo(0, -size * .78);
            context.bezierCurveTo(size * .78, -size * .25, size * .62, size * .72, 0, size * .82);
            context.bezierCurveTo(-size * .62, size * .72, -size * .78, -size * .25, 0, -size * .78);
        }

        context.fill();
        if (kind.shape === 1 || kind.shape === 6) {
            context.beginPath();
            context.moveTo(0, -size * .4);
            context.quadraticCurveTo(size * .24, 0, 0, size * .4);
            context.stroke();
        } else if (kind.shape === 0 || kind.shape === 4 || kind.shape === 5) {
            context.beginPath();
            context.moveTo(0, -size * .55);
            context.lineTo(0, size * .55);
            context.stroke();
        }
        context.restore();
    }

    function spawnSeed(initial = false) {
        seeds.push({
            x: width * (.035 + Math.random() * .93),
            y: initial ? height * Math.random() : -24 - Math.random() * 40,
            size: 7 + Math.random() * 7,
            speed: reducedMotion.matches ? 28 + Math.random() * 12 : 70 + Math.random() * 40,
            drift: reducedMotion.matches ? 2 + Math.random() * 4 : 5 + Math.random() * 10,
            phase: Math.random() * Math.PI * 2,
            rotation: Math.random() * Math.PI,
            spin: (Math.random() - .5) * .32,
            opacity: .24 + Math.random() * .2,
            kind: nextKind
        });
        nextKind = (nextKind + 1) % seedKinds.length;
    }

    function animate(time) {
        frameId = 0;
        if (document.hidden || !catalogVisible) return;
        const delta = Math.min((time - (lastTime || time)) / 1000, .05);
        lastTime = time;
        spawnElapsed += delta;
        const spawnInterval = reducedMotion.matches ? 1.25 : .48;
        if (spawnElapsed >= spawnInterval) {
            spawnElapsed %= spawnInterval;
            if (seeds.length < 72) spawnSeed();
        }
        context.clearRect(0, 0, width, height);
        for (let index = seeds.length - 1; index >= 0; index -= 1) {
            const seed = seeds[index];
            seed.y += seed.speed * delta;
            seed.x += Math.sin(time / 1600 + seed.phase) * seed.drift * delta;
            seed.rotation += seed.spin * delta;
            drawSeed(seed);
            if (seed.y > height + seed.size * 2) seeds.splice(index, 1);
        }
        frameId = window.requestAnimationFrame(animate);
    }

    function resizeCanvas() {
        const bounds = canvas.getBoundingClientRect();
        const nextWidth = Math.max(1, bounds.width);
        const nextHeight = Math.max(1, bounds.height);
        pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        width = nextWidth;
        height = nextHeight;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        lastTime = 0;
        if (!seeds.length) {
            for (let index = 0; index < 16; index += 1) spawnSeed(true);
        }
        if (!document.hidden && catalogVisible && !frameId) frameId = window.requestAnimationFrame(animate);
    }

    function pause() {
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
        lastTime = 0;
    }

    function resume() {
        if (!document.hidden && catalogVisible && !frameId) frameId = window.requestAnimationFrame(animate);
    }

    if (context) {
        window.addEventListener('resize', resizeCanvas, { passive: true });
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(([entry]) => {
                catalogVisible = entry.isIntersecting;
                canvas.style.visibility = catalogVisible ? 'visible' : 'hidden';
                catalogVisible ? resume() : pause();
            }).observe(catalog);
        }
        document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());
        const handleMotionChange = () => {
            pause();
            seeds.length = 0;
            resizeCanvas();
        };
        if ('addEventListener' in reducedMotion) reducedMotion.addEventListener('change', handleMotionChange);
        else reducedMotion.addListener(handleMotionChange);
        resizeCanvas();
    }
}
