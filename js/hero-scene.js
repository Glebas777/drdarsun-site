const heroScene = document.querySelector('.hero-scene');

if (heroScene) {
    heroScene.addEventListener('contextmenu', event => event.preventDefault());
    heroScene.addEventListener('dragstart', event => event.preventDefault());
}
