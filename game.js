// Death Loop: Your Past Hunts You
// Vanilla JavaScript + HTML5 Canvas. No dependencies.

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
// Logical size used by all game code; the backing store is scaled for sharp HiDPI rendering.
const width = canvas.width;
const height = canvas.height;

function setupCanvasResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // resizing the canvas resets the transform
}
setupCanvasResolution();

const ui = {
    container: document.getElementById('game-container'),
    startOverlay: document.getElementById('start-overlay'),
    startButton: document.getElementById('start-button'),
    pauseOverlay: document.getElementById('pause-overlay'),
    pauseButton: document.getElementById('pause-button'),
    muteButton: document.getElementById('mute-button'),
    gameOverOverlay: document.getElementById('game-over-overlay'),
    gameOverReason: document.getElementById('game-over-reason'),
    restartButton: document.getElementById('restart-button'),
    glitchOverlay: document.getElementById('glitch-overlay'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    timerBar: document.getElementById('timer-bar'),
    finalScore: document.getElementById('final-score'),
    finalLevel: document.getElementById('final-level'),
    finalTime: document.getElementById('final-time'),
    finalBest: document.getElementById('final-best'),
    newBest: document.getElementById('new-best')
};

// ---------- Constants ----------
const ARENA_LEFT = 50;
const ARENA_RIGHT = width - 50;
const ARENA_TOP = 50;
const ARENA_BOTTOM = height - 50;
const PLAYER_SPEED = 200; // pixels per second
const DASH_SPEED = 420;
const DASH_DURATION = 0.2; // seconds
const DASH_COOLDOWN = 0.8; // seconds
const BULLET_SPEED = 300;
const BULLET_LIFETIME = 2; // seconds
const BULLET_RADIUS = 3;
const ATTACK_COOLDOWN = 0.5; // seconds
const ENTITY_RADIUS = 10;
const MAX_LIVES = 5;
const MAX_TIME = 10; // seconds to reach the zone
const INVULNERABLE_TIME = 1; // seconds of protection after a hit
const LEVEL_DURATION = 20; // seconds per level
const ZONE_POINTS = 10;
const CLONE_KILL_POINTS = 5;
const RECORDING_SECONDS = 10; // how much of the last run a ghost replays
const MAX_FRAME_TIME = 0.05; // avoids huge jumps after a lag spike
const BEST_SCORE_KEY = 'deathloop-best-score';

// Initial layout. Copied on every restart so level-up speed boosts never leak into a new game.
const INITIAL_HAZARDS = [
    {x: 150, y: 150, radius: 20, type: 'static'},
    {x: 650, y: 150, radius: 20, type: 'static'},
    {x: 150, y: 450, radius: 20, type: 'static'},
    {x: 650, y: 450, radius: 20, type: 'static'},
    {x: 400, y: 200, radius: 15, type: 'static'},
    {x: 100, y: 250, radius: 12, type: 'moving', vx: 50, vy: 0, minX: 100, maxX: 300},
    {x: 700, y: 350, radius: 12, type: 'moving', vx: -50, vy: 0, minX: 500, maxX: 700},
    {x: 250, y: 550, radius: 12, type: 'moving', vx: 0, vy: -30, minY: 350, maxY: 550}
];
// Wall paths keep at least 30px between walls (player is 20px wide) so nobody gets crushed.
const INITIAL_WALLS = [
    {x: 350, y: 250, w: 100, h: 20, type: 'moving', vx: 70, vy: 0, minX: 300, maxX: 420},
    {x: 250, y: 350, w: 20, h: 100, type: 'moving', vx: 0, vy: -60, minY: 260, maxY: 420},
    {x: 550, y: 150, w: 20, h: 100, type: 'moving', vx: 0, vy: 80, minY: 120, maxY: 260}
];
const RESPAWN_POINTS = [
    {x: 100, y: 100},
    {x: 700, y: 100},
    {x: 100, y: 500},
    {x: 700, y: 500}
];

// ---------- Game state ----------
let player;
let clones;
let bullets;
let particles;
let hazards;
let walls;
let targetZone;
let currentRespawnIndex;
let score;
let loopCount;
let timeLeft;
let survivalTime;
let currentLevel;
let maxClones;
let cloneSearchSpeed;
let glitchTimer;
let elapsed; // drives animations

let bestScore = readBestScore();
let lastTime = 0;
let keys = {};
let gameState = 'menu'; // 'menu' | 'playing' | 'paused' | 'over'
let muted = false;
let audioUnlocked = false;

function createPlayer() {
    return {
        x: RESPAWN_POINTS[0].x,
        y: RESPAWN_POINTS[0].y,
        dir: 0, // radians
        vx: 0,
        vy: 0,
        recording: [],
        attacking: false,
        dashing: false,
        dashTime: 0,
        dashCooldown: 0,
        attackCooldown: 0,
        invulnerable: 0,
        hp: MAX_LIVES
    };
}

function resetState() {
    player = createPlayer();
    clones = [];
    bullets = [];
    particles = [];
    hazards = INITIAL_HAZARDS.map(h => ({...h}));
    walls = INITIAL_WALLS.map(w => ({...w}));
    targetZone = {x: 400, y: 300, radius: 25};
    currentRespawnIndex = 1;
    score = 0;
    loopCount = 0;
    timeLeft = MAX_TIME;
    survivalTime = 0;
    currentLevel = 1;
    maxClones = 2;
    cloneSearchSpeed = 100;
    glitchTimer = 0;
    elapsed = 0;
    moveTargetZone();
}

// ---------- Best score (localStorage may be unavailable) ----------
function readBestScore() {
    try {
        return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
    } catch {
        return 0;
    }
}

function saveBestScore(value) {
    try {
        localStorage.setItem(BEST_SCORE_KEY, String(value));
    } catch {
        // Storage blocked: the best score just won't persist.
    }
}

// ---------- Audio ----------
const sounds = {
    background: new Audio('media/deathloop.mp3'),
    obstacleHit: new Audio('media/hit-hazard.wav'),
    cloneHit: new Audio('media/hit-clone.wav'),
    playerShot: new Audio('media/shot-player.wav'),
    cloneShot: new Audio('media/shot-enemy.wav')
};

sounds.background.loop = true;
sounds.background.volume = 0.45;
sounds.obstacleHit.volume = 0.7;
sounds.cloneHit.volume = 0.75;
sounds.playerShot.volume = 0.8;
sounds.cloneShot.volume = 0.5;

let audioContext = null;

function playEffect(sound) {
    if (!audioUnlocked || muted) {
        return;
    }
    // A fresh copy per play lets rapid shots overlap instead of cutting each other off.
    const copy = sound.cloneNode();
    copy.volume = sound.volume; // volume isn't copied by cloneNode
    copy.play().catch(() => {});
}

// Short descending tone for game over, generated so no extra file is needed.
function playGameOverTone() {
    if (!audioUnlocked || muted) {
        return;
    }
    try {
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 1.2);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now);
        osc.stop(now + 1.3);
    } catch {
        // Web Audio not available: stay silent.
    }
}

function startBackgroundMusic() {
    if (muted) {
        return;
    }
    sounds.background.play().catch(() => {});
}

function toggleMute() {
    muted = !muted;
    ui.muteButton.textContent = muted ? '🔇' : '🔊';
    ui.muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    if (muted) {
        sounds.background.pause();
    } else if (gameState === 'playing') {
        startBackgroundMusic();
    }
}

// ---------- Game flow ----------
function startGame() {
    if (gameState === 'playing' || gameState === 'paused') {
        return;
    }
    resetState();
    gameState = 'playing';
    audioUnlocked = true; // started from a click or key press, so the browser allows audio
    ui.startOverlay.hidden = true;
    ui.gameOverOverlay.hidden = true;
    ui.pauseOverlay.hidden = true;
    ui.glitchOverlay.hidden = true;
    ui.pauseButton.disabled = false;
    ui.pauseButton.textContent = 'Pause';
    sounds.background.currentTime = 0;
    startBackgroundMusic();
    lastTime = performance.now();
    updateHud();
    requestAnimationFrame(gameLoop);
}

function togglePause() {
    if (gameState === 'playing') {
        gameState = 'paused';
        ui.pauseOverlay.hidden = false;
        ui.pauseButton.textContent = 'Resume';
        sounds.background.pause();
    } else if (gameState === 'paused') {
        gameState = 'playing';
        ui.pauseOverlay.hidden = true;
        ui.pauseButton.textContent = 'Pause';
        startBackgroundMusic();
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

function gameOver(reason) {
    if (gameState !== 'playing') {
        return; // several deaths in one frame must only end the game once
    }
    gameState = 'over';
    keys = {};

    const finalScore = Math.floor(score);
    const isNewBest = finalScore > bestScore;
    if (isNewBest) {
        bestScore = finalScore;
        saveBestScore(bestScore);
    }

    ui.gameOverReason.textContent = reason;
    ui.finalScore.textContent = finalScore;
    ui.finalLevel.textContent = currentLevel;
    ui.finalTime.textContent = `${Math.floor(survivalTime)}s`;
    ui.finalBest.textContent = bestScore;
    ui.newBest.hidden = !isNewBest;
    ui.glitchOverlay.hidden = true;
    ui.gameOverOverlay.hidden = false;
    ui.pauseButton.disabled = true;
    ui.pauseButton.textContent = 'Pause';
    ui.restartButton.focus();

    sounds.background.pause();
    playGameOverTone();
    updateHud();
}

// ---------- Input ----------
document.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && (gameState === 'menu' || gameState === 'over')) {
        e.preventDefault();
        startGame();
        return;
    }
    // A held Space (shooting) would otherwise "click" the focused Play Again button.
    if (e.code === 'Space' && gameState === 'over') {
        e.preventDefault();
        return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
        togglePause();
        return;
    }
    if (e.code === 'KeyM') {
        toggleMute();
        return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && gameState === 'playing') {
        e.preventDefault(); // keep the page from scrolling
    }
    keys[e.code] = true;
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState === 'over') {
        e.preventDefault(); // some browsers activate buttons on Space keyup
    }
    keys[e.code] = false;
});

// Losing focus would leave keys "stuck" down, so pause and clear them.
window.addEventListener('blur', () => {
    keys = {};
    if (gameState === 'playing') {
        togglePause();
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameState === 'playing') {
        togglePause();
    }
});

ui.startButton.addEventListener('click', startGame);
ui.restartButton.addEventListener('click', startGame);
ui.pauseButton.addEventListener('click', () => {
    togglePause();
    ui.pauseButton.blur(); // so Space keeps shooting instead of clicking the button
});
ui.muteButton.addEventListener('click', () => {
    toggleMute();
    ui.muteButton.blur();
});

// ---------- Touch controls ----------
// The joystick gives a direction; the buttons simply hold the matching keyboard key.
const touchMove = {x: 0, y: 0};
const JOYSTICK_DEADZONE = 0.2;

(function setupTouchControls() {
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    let pointerId = null;

    function moveKnob(e) {
        const rect = joystick.getBoundingClientRect();
        const radius = rect.width / 2;
        let dx = e.clientX - (rect.left + radius);
        let dy = e.clientY - (rect.top + radius);
        const length = Math.hypot(dx, dy);
        if (length > radius) {
            dx = (dx / length) * radius;
            dy = (dy / length) * radius;
        }
        touchMove.x = dx / radius;
        touchMove.y = dy / radius;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    function release(e) {
        if (e.pointerId !== pointerId) {
            return;
        }
        pointerId = null;
        touchMove.x = 0;
        touchMove.y = 0;
        knob.style.transform = '';
    }

    joystick.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pointerId = e.pointerId;
        joystick.setPointerCapture(pointerId);
        moveKnob(e);
    });
    joystick.addEventListener('pointermove', (e) => {
        if (e.pointerId === pointerId) {
            moveKnob(e);
        }
    });
    joystick.addEventListener('pointerup', release);
    joystick.addEventListener('pointercancel', release);

    function holdKey(buttonId, code) {
        const button = document.getElementById(buttonId);
        const press = (e) => {
            e.preventDefault();
            keys[code] = true;
            button.classList.add('pressed');
        };
        const lift = () => {
            keys[code] = false;
            button.classList.remove('pressed');
        };
        button.addEventListener('pointerdown', press);
        button.addEventListener('pointerup', lift);
        button.addEventListener('pointercancel', lift);
        button.addEventListener('pointerleave', lift);
    }

    holdKey('touch-shoot', 'Space');
    holdKey('touch-dash', 'ShiftLeft');
})();

// ---------- Utility functions ----------
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function circleHitsRect(x, y, radius, rect) {
    return (
        x + radius > rect.x &&
        x - radius < rect.x + rect.w &&
        y + radius > rect.y &&
        y - radius < rect.y + rect.h
    );
}

function collidesWithWall(entityX, entityY, radius = ENTITY_RADIUS) {
    return walls.some(wall => circleHitsRect(entityX, entityY, radius, wall));
}

function resolveWallCollision(entity, radius = ENTITY_RADIUS) {
    walls.forEach(wall => {
        if (!circleHitsRect(entity.x, entity.y, radius, wall)) {
            return;
        }

        const pushLeft = entity.x + radius - wall.x;
        const pushRight = wall.x + wall.w - (entity.x - radius);
        const pushUp = entity.y + radius - wall.y;
        const pushDown = wall.y + wall.h - (entity.y - radius);
        const smallestPush = Math.min(pushLeft, pushRight, pushUp, pushDown);

        if (smallestPush === pushLeft) {
            entity.x = wall.x - radius;
        } else if (smallestPush === pushRight) {
            entity.x = wall.x + wall.w + radius;
        } else if (smallestPush === pushUp) {
            entity.y = wall.y - radius;
        } else {
            entity.y = wall.y + wall.h + radius;
        }
    });
}

function moveWithinBounds(position, velocity, min, max, deltaTime) {
    if (velocity === 0 || min === undefined || max === undefined) {
        return {position, velocity};
    }

    let nextPosition = position + velocity * deltaTime;
    let nextVelocity = velocity;

    while (nextPosition < min || nextPosition > max) {
        if (nextPosition < min) {
            nextPosition = min + (min - nextPosition);
            nextVelocity = Math.abs(nextVelocity);
        } else {
            nextPosition = max - (nextPosition - max);
            nextVelocity = -Math.abs(nextVelocity);
        }
    }

    return {position: nextPosition, velocity: nextVelocity};
}

// Puts the zone somewhere reachable: away from hazards, the paths of moving walls and the player.
function moveTargetZone() {
    const r = targetZone.radius;
    for (let attempt = 0; attempt < 60; attempt++) {
        const x = ARENA_LEFT + r + Math.random() * (ARENA_RIGHT - ARENA_LEFT - r * 2);
        const y = ARENA_TOP + r + Math.random() * (ARENA_BOTTOM - ARENA_TOP - r * 2);
        const candidate = {x, y};

        const nearHazard = hazards.some(h => {
            if (h.type === 'moving') {
                const minX = h.minX ?? h.x;
                const maxX = h.maxX ?? h.x;
                const minY = h.minY ?? h.y;
                const maxY = h.maxY ?? h.y;
                const path = {x: minX - h.radius, y: minY - h.radius, w: maxX - minX + h.radius * 2, h: maxY - minY + h.radius * 2};
                return circleHitsRect(x, y, r + 8, path);
            }
            return distance(candidate, h) < h.radius + r + 15;
        });
        const nearWall = walls.some(w => {
            const minX = w.minX ?? w.x;
            const maxX = w.maxX ?? w.x;
            const minY = w.minY ?? w.y;
            const maxY = w.maxY ?? w.y;
            const path = {x: minX, y: minY, w: maxX - minX + w.w, h: maxY - minY + w.h};
            return circleHitsRect(x, y, r + 8, path);
        });
        const tooClose = player && distance(candidate, player) < 150;

        if (!nearHazard && !nearWall && !tooClose) {
            targetZone.x = x;
            targetZone.y = y;
            return;
        }
    }
    // Fallback: the arena centre is always open.
    targetZone.x = width / 2;
    targetZone.y = height / 2 + 80;
}

function separateClones() {
    const minimumDistance = ENTITY_RADIUS * 2;

    for (let iteration = 0; iteration < 3; iteration++) {
        for (let i = 0; i < clones.length; i++) {
            for (let j = i + 1; j < clones.length; j++) {
                const cloneA = clones[i];
                const cloneB = clones[j];
                let dx = cloneB.x - cloneA.x;
                let dy = cloneB.y - cloneA.y;
                let dist = Math.hypot(dx, dy);

                if (dist >= minimumDistance) {
                    continue;
                }

                if (dist === 0) {
                    const angle = ((i + j + iteration) / Math.max(clones.length, 1)) * Math.PI * 2;
                    dx = Math.cos(angle);
                    dy = Math.sin(angle);
                    dist = 1;
                }

                const overlap = (minimumDistance - dist) / 2;
                const offsetX = (dx / dist) * overlap;
                const offsetY = (dy / dist) * overlap;

                cloneA.x = clamp(cloneA.x - offsetX, ARENA_LEFT, ARENA_RIGHT);
                cloneA.y = clamp(cloneA.y - offsetY, ARENA_TOP, ARENA_BOTTOM);
                cloneB.x = clamp(cloneB.x + offsetX, ARENA_LEFT, ARENA_RIGHT);
                cloneB.y = clamp(cloneB.y + offsetY, ARENA_TOP, ARENA_BOTTOM);

                resolveWallCollision(cloneA);
                resolveWallCollision(cloneB);
            }
        }
    }
}

// ---------- Effects ----------
function spawnParticles(x, y, color, count = 14, speed = 160) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = speed * (0.4 + Math.random() * 0.6);
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity,
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0.8,
            color
        });
    }
}

function shakeScreen() {
    ui.container.classList.remove('shake');
    void ui.container.offsetWidth; // restart the CSS animation
    ui.container.classList.add('shake');
}

function damagePlayer(reason) {
    player.hp--;
    player.invulnerable = INVULNERABLE_TIME;
    spawnParticles(player.x, player.y, '#38bdf8', 12, 120);
    shakeScreen();
    updateHud();
    if (player.hp <= 0) {
        gameOver(reason);
        return true;
    }
    return false;
}

// ---------- Update ----------
function update(deltaTime) {
    elapsed += deltaTime;

    // Input
    let moveX = 0;
    let moveY = 0;
    if (keys['KeyW'] || keys['ArrowUp']) moveY -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveY += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;
    if (Math.hypot(touchMove.x, touchMove.y) > JOYSTICK_DEADZONE) {
        moveX = touchMove.x;
        moveY = touchMove.y;
    }

    // Same speed in every direction (diagonals used to be ~40% faster).
    const inputLength = Math.hypot(moveX, moveY);
    if (inputLength > 0) {
        moveX /= inputLength;
        moveY /= inputLength;
        player.dir = Math.atan2(moveY, moveX);
    }

    // Dash: short burst with a cooldown, instead of an endless dash while Shift is held.
    player.dashCooldown -= deltaTime;
    const dashPressed = keys['ShiftLeft'] || keys['ShiftRight'];
    if (dashPressed && !player.dashing && player.dashCooldown <= 0 && inputLength > 0) {
        player.dashing = true;
        player.dashTime = DASH_DURATION;
        player.dashCooldown = DASH_COOLDOWN;
    }
    let speed = PLAYER_SPEED;
    if (player.dashing) {
        speed = DASH_SPEED;
        player.dashTime -= deltaTime;
        if (player.dashTime <= 0) {
            player.dashing = false;
        }
    }

    player.vx = moveX * speed;
    player.vy = moveY * speed;
    player.x += player.vx * deltaTime;
    player.y += player.vy * deltaTime;
    player.invulnerable = Math.max(0, player.invulnerable - deltaTime);

    // Moving walls, before collision resolution
    walls.forEach(wall => {
        if (wall.type !== 'moving') {
            return;
        }
        const nextX = moveWithinBounds(wall.x, wall.vx || 0, wall.minX, wall.maxX, deltaTime);
        const nextY = moveWithinBounds(wall.y, wall.vy || 0, wall.minY, wall.maxY, deltaTime);
        wall.x = nextX.position;
        wall.vx = nextX.velocity;
        wall.y = nextY.position;
        wall.vy = nextY.velocity;
    });

    resolveWallCollision(player);
    player.x = clamp(player.x, ARENA_LEFT, ARENA_RIGHT);
    player.y = clamp(player.y, ARENA_TOP, ARENA_BOTTOM);

    // Attack
    player.attacking = false;
    player.attackCooldown -= deltaTime;
    if (keys['Space'] && player.attackCooldown <= 0) {
        player.attacking = true;
        player.attackCooldown = ATTACK_COOLDOWN;
        playEffect(sounds.playerShot);
        bullets.push({
            x: player.x + Math.cos(player.dir) * ENTITY_RADIUS,
            y: player.y + Math.sin(player.dir) * ENTITY_RADIUS,
            vx: Math.cos(player.dir) * BULLET_SPEED,
            vy: Math.sin(player.dir) * BULLET_SPEED,
            owner: 'player',
            lifetime: BULLET_LIFETIME
        });
    }

    // Record this frame so a future clone can replay it
    // Only the last few seconds are kept, so a new ghost starts hunting quickly.
    player.recording.push({x: player.x, y: player.y, dir: player.dir, attacking: player.attacking, t: elapsed});
    while (player.recording[0].t < elapsed - RECORDING_SECONDS) {
        player.recording.shift();
    }

    // Clones: replay the recorded run, then hunt the player
    clones.forEach(clone => {
        clone.trail.push({x: clone.x, y: clone.y});
        if (clone.trail.length > 12) {
            clone.trail.shift();
        }

        if (clone.index < clone.recording.length) {
            const state = clone.recording[clone.index];
            clone.x = state.x;
            clone.y = state.y;
            clone.dir = state.dir;
            if (state.attacking) {
                playEffect(sounds.cloneShot);
                bullets.push({
                    x: clone.x + Math.cos(clone.dir) * ENTITY_RADIUS,
                    y: clone.y + Math.sin(clone.dir) * ENTITY_RADIUS,
                    vx: Math.cos(clone.dir) * BULLET_SPEED,
                    vy: Math.sin(clone.dir) * BULLET_SPEED,
                    owner: 'clone',
                    lifetime: BULLET_LIFETIME
                });
            }
            clone.index++;
            return;
        }

        clone.hunting = true;
        const dx = player.x - clone.x;
        const dy = player.y - clone.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 0) {
            clone.dir = Math.atan2(dy, dx);
            const step = Math.min(cloneSearchSpeed * deltaTime, dist);
            const nextX = clone.x + Math.cos(clone.dir) * step;
            const nextY = clone.y + Math.sin(clone.dir) * step;

            if (!collidesWithWall(nextX, clone.y)) {
                clone.x = nextX;
            }
            if (!collidesWithWall(clone.x, nextY)) {
                clone.y = nextY;
            }
        }

        clone.x = clamp(clone.x, ARENA_LEFT, ARENA_RIGHT);
        clone.y = clamp(clone.y, ARENA_TOP, ARENA_BOTTOM);
        resolveWallCollision(clone);
    });

    separateClones();

    // Moving hazards
    hazards.forEach(hazard => {
        if (hazard.type !== 'moving') {
            return;
        }
        const nextX = moveWithinBounds(hazard.x, hazard.vx || 0, hazard.minX, hazard.maxX, deltaTime);
        const nextY = moveWithinBounds(hazard.y, hazard.vy || 0, hazard.minY, hazard.maxY, deltaTime);
        hazard.x = nextX.position;
        hazard.vx = nextX.velocity;
        hazard.y = nextY.position;
        hazard.vy = nextY.velocity;
    });

    // Bullets: move, then resolve hits. Removed items are filtered out afterwards
    // (removing while looping used to skip bullets and clones).
    const usedBullets = new Set();
    const killedClones = new Set();

    for (const bullet of bullets) {
        bullet.x += bullet.vx * deltaTime;
        bullet.y += bullet.vy * deltaTime;
        bullet.lifetime -= deltaTime;

        if (bullet.lifetime <= 0 || bullet.x < 0 || bullet.x > width || bullet.y < 0 || bullet.y > height) {
            usedBullets.add(bullet);
            continue;
        }
        if (collidesWithWall(bullet.x, bullet.y, BULLET_RADIUS)) {
            spawnParticles(bullet.x, bullet.y, '#94a3b8', 4, 60);
            usedBullets.add(bullet);
            continue;
        }

        if (bullet.owner === 'clone') {
            if (distance(bullet, player) < ENTITY_RADIUS + BULLET_RADIUS) {
                usedBullets.add(bullet);
                if (player.invulnerable <= 0) {
                    playEffect(sounds.cloneHit);
                    if (damagePlayer('Shot down by your own past.')) {
                        return;
                    }
                }
            }
            continue;
        }

        const target = clones.find(c => !killedClones.has(c) && distance(bullet, c) < ENTITY_RADIUS + BULLET_RADIUS);
        if (target) {
            killedClones.add(target);
            usedBullets.add(bullet);
            score += CLONE_KILL_POINTS;
            spawnParticles(target.x, target.y, '#f43f5e', 18, 180);
        }
    }

    bullets = bullets.filter(b => !usedBullets.has(b));
    clones = clones.filter(c => !killedClones.has(c));

    // Clone contact: one hit, then a short invulnerability window
    // (it used to drain a life every frame while touching).
    if (player.invulnerable <= 0) {
        const touching = clones.find(clone => distance(clone, player) < ENTITY_RADIUS * 2);
        if (touching) {
            playEffect(sounds.cloneHit);
            const dx = player.x - touching.x;
            const dy = player.y - touching.y;
            const dist = Math.hypot(dx, dy) || 1;
            player.x = clamp(player.x + (dx / dist) * 25, ARENA_LEFT, ARENA_RIGHT);
            player.y = clamp(player.y + (dy / dist) * 25, ARENA_TOP, ARENA_BOTTOM);
            if (damagePlayer('Caught by a ghost of yourself.')) {
                return;
            }
        }
    }

    // Hazard contact: lose a life, loop back and leave a ghost behind.
    // Respects the post-hit protection, like clones and bullets.
    const hitHazard = player.invulnerable <= 0 &&
        hazards.find(hazard => distance(hazard, player) < hazard.radius + ENTITY_RADIUS);
    if (hitHazard) {
        playEffect(sounds.obstacleHit);
        spawnParticles(player.x, player.y, '#b91c1c', 16, 150);
        if (damagePlayer('Your loops ran out.')) {
            return;
        }
        dieFromObstacle();
    }

    // Target zone
    if (distance(player, targetZone) < targetZone.radius + ENTITY_RADIUS) {
        score += ZONE_POINTS;
        timeLeft = MAX_TIME;
        spawnParticles(targetZone.x, targetZone.y, '#4ade80', 20, 140);
        moveTargetZone();
    }

    // Timer
    timeLeft -= deltaTime;
    if (timeLeft <= 0) {
        timeLeft = 0;
        gameOver('Time ran out before you reached the zone.');
        return;
    }

    // Survival level
    survivalTime += deltaTime;
    const newLevel = Math.floor(survivalTime / LEVEL_DURATION) + 1;
    if (newLevel > currentLevel) {
        currentLevel = newLevel;
        triggerLevelUp();
    }

    // Glitch banner
    if (glitchTimer > 0) {
        glitchTimer -= deltaTime;
        if (glitchTimer <= 0) {
            ui.glitchOverlay.hidden = true;
        }
    }

    // Particles
    // 0.92 per frame at 60 fps, scaled so the slowdown is the same at any frame rate.
    const drag = Math.pow(0.92, deltaTime * 60);
    particles.forEach(p => {
        p.x += p.vx * deltaTime;
        p.y += p.vy * deltaTime;
        p.vx *= drag;
        p.vy *= drag;
        p.life -= deltaTime;
    });
    particles = particles.filter(p => p.life > 0);
}

function triggerLevelUp() {
    ui.glitchOverlay.hidden = false;
    glitchTimer = 2.0;
    playEffect(sounds.obstacleHit);

    maxClones = Math.min(6, 1 + currentLevel);
    cloneSearchSpeed = 100 + currentLevel * 20;

    hazards.forEach(h => {
        if (h.type === 'moving') {
            h.vx = h.vx > 0 ? h.vx + 10 : (h.vx < 0 ? h.vx - 10 : 0);
            h.vy = h.vy > 0 ? h.vy + 10 : (h.vy < 0 ? h.vy - 10 : 0);
        }
    });
}

// Hitting a hazard: the run so far becomes a ghost clone and the player respawns.
function dieFromObstacle() {
    const recording = player.recording;
    if (clones.length < maxClones && recording.length > 0) {
        clones.push({
            recording: [...recording],
            index: 0,
            x: recording[0].x,
            y: recording[0].y,
            dir: recording[0].dir,
            trail: [],
            hunting: false
        });
    }

    const spawn = RESPAWN_POINTS[currentRespawnIndex];
    player.x = spawn.x;
    player.y = spawn.y;
    currentRespawnIndex = (currentRespawnIndex + 1) % RESPAWN_POINTS.length;
    player.recording = [];
    player.dashing = false;
    loopCount++;
}

// ---------- Draw ----------
function drawArena() {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ARENA_LEFT; x <= ARENA_RIGHT; x += 25) {
        ctx.moveTo(x + 0.5, ARENA_TOP);
        ctx.lineTo(x + 0.5, ARENA_BOTTOM);
    }
    for (let y = ARENA_TOP; y <= ARENA_BOTTOM; y += 25) {
        ctx.moveTo(ARENA_LEFT, y + 0.5);
        ctx.lineTo(ARENA_RIGHT, y + 0.5);
    }
    ctx.stroke();

    // Border
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;
    ctx.strokeRect(ARENA_LEFT, ARENA_TOP, ARENA_RIGHT - ARENA_LEFT, ARENA_BOTTOM - ARENA_TOP);
    ctx.shadowBlur = 0;
}

function drawCircle(x, y, radius, color, glow = 0) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawDirection(entity, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(entity.x + Math.cos(entity.dir) * 6, entity.y + Math.sin(entity.dir) * 6);
    ctx.lineTo(entity.x + Math.cos(entity.dir) * 17, entity.y + Math.sin(entity.dir) * 17);
    ctx.stroke();
}

function draw() {
    drawArena();

    // Walls
    walls.forEach(wall => {
        ctx.fillStyle = '#334155';
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
    });

    // Hazards (pulsing)
    hazards.forEach((hazard, i) => {
        const pulse = 1 + Math.sin(elapsed * 4 + i) * 0.08;
        drawCircle(hazard.x, hazard.y, hazard.radius * pulse, '#b91c1c', 16);
        drawCircle(hazard.x, hazard.y, hazard.radius * 0.45, '#ef4444');
    });

    // Target zone (pulsing ring)
    const zonePulse = 1 + Math.sin(elapsed * 5) * 0.1;
    ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
    ctx.beginPath();
    ctx.arc(targetZone.x, targetZone.y, targetZone.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(targetZone.x, targetZone.y, targetZone.radius * zonePulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Clones: translucent ghosts with a fading trail
    clones.forEach(clone => {
        clone.trail.forEach((point, i) => {
            const alpha = (i / clone.trail.length) * 0.25;
            ctx.fillStyle = `rgba(244, 63, 94, ${alpha})`;
            ctx.beginPath();
            ctx.arc(point.x, point.y, ENTITY_RADIUS * (0.5 + i / clone.trail.length / 2), 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = clone.hunting ? 0.95 : 0.7;
        drawCircle(clone.x, clone.y, ENTITY_RADIUS, '#f43f5e', 18);
        drawDirection(clone, '#fecdd3');
        ctx.globalAlpha = 1;
    });

    // Player (blinks while invulnerable)
    const visible = player.invulnerable <= 0 || Math.floor(elapsed * 14) % 2 === 0;
    if (visible) {
        drawCircle(player.x, player.y, ENTITY_RADIUS, player.dashing ? '#a5f3fc' : '#38bdf8', player.dashing ? 28 : 18);
        drawDirection(player, '#e0f2fe');
    }

    // Bullets
    bullets.forEach(bullet => {
        drawCircle(bullet.x, bullet.y, BULLET_RADIUS, bullet.owner === 'player' ? '#fde047' : '#fb923c', 10);
    });

    // Particles
    particles.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;

    updateHud();
}

// Last values written to the DOM, so each frame only touches what changed.
const hudCache = {};

function setHud(key, value, apply) {
    if (hudCache[key] !== value) {
        hudCache[key] = value;
        apply(value);
    }
}

function updateHud() {
    const hp = player ? Math.max(0, player.hp) : MAX_LIVES;
    const time = timeLeft ?? MAX_TIME;
    // Rounded to 0.1% so the bar still moves smoothly without a write every frame.
    const timerPercent = Math.round(clamp(time / MAX_TIME, 0, 1) * 1000) / 10;

    setHud('score', Math.floor(score ?? 0), v => { ui.score.textContent = v; });
    setHud('best', bestScore, v => { ui.best.textContent = v; });
    setHud('level', currentLevel ?? 1, v => { ui.level.textContent = v; });
    setHud('hp', hp, v => {
        ui.lives.textContent = '♥'.repeat(v) + '♡'.repeat(MAX_LIVES - v);
        ui.lives.setAttribute('aria-label', `${v} lives`);
    });
    setHud('timer', timerPercent, v => { ui.timerBar.style.width = `${v}%`; });
    setHud('danger', time <= 4, v => { ui.timerBar.classList.toggle('danger', v); });
}

// ---------- Game loop ----------
function gameLoop(currentTime) {
    if (gameState !== 'playing') {
        return;
    }

    const deltaTime = Math.min((currentTime - lastTime) / 1000, MAX_FRAME_TIME);
    lastTime = currentTime;

    update(deltaTime);
    draw();

    if (gameState === 'playing') {
        requestAnimationFrame(gameLoop);
    }
}

// Draw the arena behind the start screen.
resetState();
draw();

// Browser zoom or moving to another monitor changes the pixel ratio.
window.addEventListener('resize', () => {
    setupCanvasResolution();
    if (gameState !== 'playing') {
        draw(); // the loop isn't running, so repaint the cleared canvas
    }
});
