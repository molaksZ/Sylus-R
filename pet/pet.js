/* ============================================================
 * N109 攻略站 · Q版彻 桌面小人
 * 依赖：./mmd-viewer.js（three + MMDLoader 打包版）、./model/casual
 * 行为：在页面里自由走动、停下发呆、被打招呼会挥手、点击会说话
 * ============================================================ */
import { MMDCompanionViewer } from './mmd-viewer.js';

const MODEL_URL = new URL('./model/casual/model.pmx', import.meta.url).href;
const LS_OFF = 'n109_pet_off';
const LS_POS = 'n109_pet_pos';

/* 台词：短句为主，说话时不至于占满屏幕 */
const LINES = [
    '握在手里的就是我的，比如你的手。',
    '我不会故意说话讨好你，也不会对你说谎。',
    '我更习惯做主动的那一方。',
    '我只喜欢掌控局势，而非控制人。',
    '能随时随地的发呆也是种技能。',
    '就算遇到最差的情况，也用不着这么着急。',
    '每次当完美的时机出现，我偶尔也会相信命运。',
    '了解自己的优势并适时利用它，是我一贯的信条。',
    '你是预期之外的刻痕。',
    '尽管奔向我，我会是你最后一道防线。',
    '一味讨好只会让自己丧失主动权。',
    '别妄自菲薄，你还比自己想象中更有用。',
    '在太阳升起来前，不如一起成为黑夜的主人。',
    '再远的距离，只要我想，都不是问题。'
];
const WAVE_LINES = ['…有事？', '看什么，过来。', '嗯。', '我在这儿。'];

const mobile = matchMedia('(max-width: 640px)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = mobile ? 34 : 46;          // px / 秒
const PAUSE_MIN = 1400, PAUSE_MAX = 4200;

let viewer = null, canvas = null, wrap = null, bubble = null, toggle = null;
let raf = 0, started = false;
let pos = { x: 0, y: 0 }, target = { x: 0, y: 0 };
let phase = 'pause', phaseUntil = 0, bubbleTimer = 0, last = 0;


/* ------------------------------------------------------------
 * MMD 默认是 T 字站姿，这里把手臂「压下来」变成自然垂手。
 * 做法：直接改 viewer 里缓存的静止姿势（boneRest），
 *       viewer 每帧都会从它恢复，所以改一次就永久生效。
 * 三.js 没导出，这里用四元数手算（绕 Z 轴旋转）。
 * ------------------------------------------------------------ */
const quatZ = (z) => [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
}
function relaxArms() {
    const rest = viewer && viewer.boneRest, map = viewer && viewer.boneMap;
    if (!rest || !map || !rest.size) return;
    const bend = (bone, z) => {
        if (!bone) return;
        const r = rest.get(bone);
        if (!r || !r.quaternion) return;
        const q = r.quaternion;
        const n = quatMul([q.x, q.y, q.z, q.w], quatZ(z));
        q.set(n[0], n[1], n[2], n[3]);
        bone.quaternion.copy(q);
    };
    bend(map.upperArmL, -1.24);
    bend(map.upperArmR, 1.24);
    bend(map.elbowL, -0.14);
    bend(map.elbowR, 0.14);
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function size() {
    const r = wrap.getBoundingClientRect();
    return { w: r.width || 190, h: r.height || 250 };
}
function pickTarget() {
    const { w, h } = size();
    const top = Math.max(70, innerHeight * 0.28);
    const bottom = Math.max(top + 40, innerHeight - h - 12);
    return { x: rand(6, Math.max(8, innerWidth - w - 6)), y: rand(top, bottom) };
}
function apply() {
    wrap.style.setProperty('--px', pos.x + 'px');
    wrap.style.setProperty('--py', pos.y + 'px');
    wrap.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
}
function say(text, ms = 3200) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (reduceMotion) return;

    if (phase === 'walk') {
        const dx = target.x - pos.x, dy = target.y - pos.y;
        const dist = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (dist <= step) {
            pos.x = target.x; pos.y = target.y;
            phase = 'pause';
            phaseUntil = now + rand(PAUSE_MIN, PAUSE_MAX);
            apply();
            if (Math.random() < 0.25 && viewer) viewer.playGesture('wave');
        } else {
            pos.x += (dx / dist) * step;
            pos.y += (dy / dist) * step;
            apply();
        }
    } else if (now >= phaseUntil) {
        target = pickTarget();
        phase = 'walk';
    }
}

function onPointerUp(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (viewer) viewer.playGesture('wave');
    say(WAVE_LINES[(Math.random() * WAVE_LINES.length) | 0]);
    if (Math.random() < 0.5) { target = pickTarget(); phase = 'walk'; }
}

async function boot() {
    if (started) return;
    started = true;
    wrap = document.createElement('div');
    wrap.id = 'n109-pet';
    wrap.innerHTML = '<div id="n109-pet-bubble"></div><canvas id="n109-pet-canvas"></canvas>';
    document.body.appendChild(wrap);
    bubble = wrap.querySelector('#n109-pet-bubble');
    canvas = wrap.querySelector('#n109-pet-canvas');

    toggle = document.createElement('button');
    toggle.id = 'n109-pet-toggle';
    toggle.type = 'button';
    toggle.title = '召唤 / 收起 Q版彻';
    toggle.textContent = '🐾';
    toggle.addEventListener('click', () => setEnabled(!enabled));
    document.body.appendChild(toggle);

    const { w, h } = size();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_POS) || 'null'); } catch (e) {}
    pos = (saved && Number.isFinite(saved.x)) ? { x: clamp(saved.x, 0, innerWidth - w), y: clamp(saved.y, 0, innerHeight - h) }
        : { x: innerWidth - w - 18, y: innerHeight - h - 12 };
    target = { ...pos };
    apply();

    try {
        viewer = new MMDCompanionViewer(canvas, { onStatus: () => {} });
        if (viewer.setAccessory) viewer.setAccessory('none');
        await viewer.loadModel(MODEL_URL, { id: 'casual', name: '常服' });
        if (viewer.setView) viewer.setView('front');
        relaxArms();
        wrap.classList.add('ready');
        setTimeout(() => say('……来了？', 2600), 600);
    } catch (err) {
        console.error('[N109 pet] 模型加载失败', err);
        wrap.classList.add('ready');
    }

    canvas.addEventListener('pointerup', onPointerUp);
    addEventListener('resize', () => {
        const s = size();
        pos.x = clamp(pos.x, 0, Math.max(0, innerWidth - s.w));
        pos.y = clamp(pos.y, 0, Math.max(0, innerHeight - s.h));
        target = pickTarget();
        apply();
    });
    setInterval(() => {
        if (document.hidden || phase !== 'pause') return;
        if (Math.random() < 0.35) say(LINES[(Math.random() * LINES.length) | 0], 4200);
    }, 45000);

    last = 0;
    raf = requestAnimationFrame(tick);
}

let enabled = true;
function setEnabled(on) {
    enabled = on;
    localStorage.setItem(LS_OFF, on ? '0' : '1');
    toggle.classList.toggle('off', !on);
    if (on) {
        wrap.classList.remove('hidden');
        if (!started || !viewer) boot(); else { last = 0; if (!raf) raf = requestAnimationFrame(tick); }
    } else {
        wrap.classList.add('hidden');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (viewer && viewer.dispose) { try { viewer.dispose(); } catch (e) {} viewer = null; started = false; wrap.innerHTML = '<div id="n109-pet-bubble"></div><canvas id="n109-pet-canvas"></canvas>'; bubble = wrap.querySelector('#n109-pet-bubble'); canvas = wrap.querySelector('#n109-pet-canvas'); }
    }
}

/* 等页面闲下来再加载，别抢首屏带宽 */
function schedule() {
    const off = localStorage.getItem(LS_OFF) === '1';
    if (off) {
        // 仍然要显示按钮，方便随时召回
        const b = document.createElement('button');
        b.id = 'n109-pet-toggle'; b.type = 'button'; b.className = 'off'; b.title = '召唤 / 收起 Q版彻'; b.textContent = '🐾';
        b.addEventListener('click', () => { toggle = b; wrap = document.createElement('div'); wrap.id = 'n109-pet'; wrap.className = 'hidden'; wrap.innerHTML = '<div id="n109-pet-bubble"></div><canvas id="n109-pet-canvas"></canvas>'; document.body.appendChild(wrap); setEnabled(true); });
        document.body.appendChild(b);
        return;
    }
    document.body.classList.add('n109-pet-on');
    const run = () => boot();
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 1200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
else schedule();