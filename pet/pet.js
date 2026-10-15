/* ============================================================
 * N109 攻略站 · Q版彻 桌面小人
 * 依赖：./mmd-viewer.js（three + MMDLoader 打包版）、./model/casual
 * 行为：自由走动（自然摆臂）、停下发呆、挥手说话、
 *      听到声音戴耳机听歌（红/黑可换）、走累了坐皮沙发休息
 * ============================================================ */
import { MMDCompanionViewer } from './mmd-viewer.js';

const MODEL_URL = new URL('./model/casual/model.pmx', import.meta.url).href;
const LS_OFF = 'n109_pet_off';
const LS_POS = 'n109_pet_pos';
const LS_EAR = 'n109_pet_earphone';   // 'red' | 'black'
const LS_AUDIO = 'n109_pet_audio';    // '1' | '0'

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
const SIT_LINES = ['走累了，坐会儿。', '……这沙发不错。', '安静一会儿。'];

const mobile = matchMedia('(max-width: 640px)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = mobile ? 34 : 46;
const PAUSE_MIN = 1400, PAUSE_MAX = 4200;
const WALK_BEFORE_REST = 26000;    // 累计走这么久就去找沙发
const REST_MS_MIN = 14000, REST_MS_MAX = 26000;

let viewer = null, canvas = null, wrap = null, bubble = null, toggle = null, earBtn = null, audioBtn = null;
let sofa = null, phones = null;
let raf = 0, started = false, sitting = false, sittingUntil = 0, walkedMs = 0, cheer = 0;
let pos = { x: 0, y: 0 }, target = { x: 0, y: 0 };
let phase = 'pause', phaseUntil = 0, bubbleTimer = 0, last = 0;
let audioMode = localStorage.getItem(LS_AUDIO) === '1';
let earphone = localStorage.getItem(LS_EAR) === 'black' ? 'black' : 'red';
let soundLevel = 0, soundActive = false, analyser = null, audioCtx = null, audioStream = null;
let sitOffsetY = -2.15, sitOffsetX = 0, sitScaleMul = 0.72, baseScale = 1;
const testOps = [];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- 四元数小工具（three 没导出，手算） ---------- */
const quatZ = (z) => [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
function quatEuler(x, y, z) {
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz
    ];
}
function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
}
/* 把静止姿势改成「手臂自然垂下」 */
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
/* 在 viewer 每帧摆完骨之后，叠加走路摆臂 / 听歌点头 */
function addRot(bone, x, y, z) {
    if (!bone || !bone.quaternion) return;
    const q = bone.quaternion;
    const n = quatMul([q.x, q.y, q.z, q.w], quatEuler(x, y, z));
    q.set(n[0], n[1], n[2], n[3]);
}
let legBones = null;
function findLegBones() {
    if (!viewer || !viewer.bones) return null;
    const by = (n) => viewer.bones.find(b => b.name === n) || null;
    return {
        thighL: by('左足D'), thighR: by('右足D'),
        kneeL: by('左ひざD'), kneeR: by('右ひざD'),
        ankleL: by('左足首D'), ankleR: by('右足首D')
    };
}
function decorate(t) {
    const map = viewer && viewer.boneMap;
    if (!map) return;
    if (!legBones) legBones = findLegBones();
    for (const op of testOps) { const b = viewer.bones.find(v => v.name === op.name); if (b) addRot(b, op.x, op.y, op.z); }

    if (sitting) {
        if (viewer.chair) viewer.chair.visible = false;
        if (viewer.modelPivot) {
            viewer.modelPivot.position.y = sitOffsetY;
            viewer.modelPivot.rotation.y = sitOffsetX;
            viewer.modelPivot.scale.setScalar(baseScale * sitScaleMul);
        }
        addRot(map.upperBody, 0.10, 0, 0);
        addRot(map.head, 0.04, 0, 0);
        addRot(map.upperArmL, 0.34, 0, 0);
        addRot(map.upperArmR, -0.34, 0, 0);
        addRot(map.elbowL, 0.26, 0, 0);
        addRot(map.elbowR, -0.26, 0, 0);
        if (legBones) {
            const swing = Math.sin(t * 1.4) * 0.02;   // 坐着的细微晃动
            addRot(legBones.thighL, -1.30 + swing, 0, 0.07);
            addRot(legBones.thighR, -1.30 + swing, 0, -0.07);
            addRot(legBones.kneeL, 1.42, 0, 0);
            addRot(legBones.kneeR, 1.42, 0, 0);
            addRot(legBones.ankleL, -0.16, 0, 0);
            addRot(legBones.ankleR, -0.16, 0, 0);
        }
    } else {
        const moving = phase === 'walk' ? 1 : 0.06;
        const s = Math.sin(t * 6.4);
        // 摆臂
        addRot(map.upperArmL, s * 0.62 * moving, 0, 0);
        addRot(map.upperArmR, -s * 0.62 * moving, 0, 0);
        addRot(map.elbowL, Math.max(0, -s) * 0.42 * moving, 0, 0);
        addRot(map.elbowR, Math.max(0, s) * 0.42 * moving, 0, 0);
        // 迈腿（腿在 *D 骨骼上，D 骨骼才带动网格）
        if (legBones) {
            addRot(legBones.thighL, -s * 0.62 * moving, 0, 0);
            addRot(legBones.thighR, s * 0.62 * moving, 0, 0);
            addRot(legBones.kneeL, Math.max(0, s) * 0.80 * moving, 0, 0);
            addRot(legBones.kneeR, Math.max(0, -s) * 0.80 * moving, 0, 0);
            addRot(legBones.ankleL, Math.max(0, -s) * 0.22 * moving, 0, 0);
            addRot(legBones.ankleR, Math.max(0, s) * 0.22 * moving, 0, 0);
        }
    }
    // 听歌时轻轻点头
    if (soundActive && !sitting) {
        addRot(map.head, 0, 0, Math.sin(t * 5.2) * 0.05);
        addRot(map.upperBody, 0, Math.sin(t * 2.6) * 0.03, 0);
    }
}
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
    wrap.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
}
function say(text, ms = 3200) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

/* ---------- 耳机 / 沙发 ---------- */
function earphoneSvg(color) {
    const main = color === 'black' ? '#1c1c20' : '#c8382f';
    const dark = color === 'black' ? '#000000' : '#7d1d16';
    const light = color === 'black' ? '#3a3a42' : '#ef6a5e';
    return `<svg viewBox="0 0 120 92" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 62 V44 A48 48 0 0 1 108 44 V62" fill="none" stroke="${main}" stroke-width="11" stroke-linecap="round"/>
      <path d="M12 62 V44 A48 48 0 0 1 108 44 V62" fill="none" stroke="${light}" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
      <rect x="2" y="52" width="26" height="34" rx="11" fill="${main}" stroke="${dark}" stroke-width="3"/>
      <rect x="92" y="52" width="26" height="34" rx="11" fill="${main}" stroke="${dark}" stroke-width="3"/>
      <rect x="7" y="58" width="16" height="20" rx="7" fill="${dark}" opacity="0.55"/>
      <rect x="97" y="58" width="16" height="20" rx="7" fill="${dark}" opacity="0.55"/>
    </svg>`;
}
function renderEarphone() {
    if (!phones) return;
    phones.innerHTML = earphoneSvg(earphone);
}
const SOFA_SVG = `<svg viewBox="0 0 180 88" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="20" width="168" height="46" rx="10" fill="#7d2f24" stroke="#3a120c" stroke-width="4"/>
  <rect x="14" y="8" width="152" height="34" rx="9" fill="#96402f" stroke="#3a120c" stroke-width="4"/>
  <path d="M62 10 V42 M118 10 V42" stroke="#6b261c" stroke-width="3"/>
  <rect x="0" y="34" width="26" height="46" rx="10" fill="#a34a35" stroke="#3a120c" stroke-width="4"/>
  <rect x="154" y="34" width="26" height="46" rx="10" fill="#a34a35" stroke="#3a120c" stroke-width="4"/>
  <rect x="14" y="58" width="152" height="18" rx="7" fill="#8a382a" stroke="#3a120c" stroke-width="4"/>
  <rect x="26" y="76" width="14" height="10" rx="3" fill="#42180f"/>
  <rect x="140" y="76" width="14" height="10" rx="3" fill="#42180f"/>
</svg>`;

/* ---------- 声音检测 ---------- */
function pageMediaPlaying() {
    const list = document.querySelectorAll('audio, video');
    for (const el of list) {
        if (!el.paused && !el.muted && el.volume > 0 && el.currentTime > 0) return true;
    }
    return false;
}
async function enableAudio() {
    audioMode = true;
    localStorage.setItem(LS_AUDIO, '1');
    audioBtn && audioBtn.classList.add('on');
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            audioStream = stream;
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC();
            const src = audioCtx.createMediaStreamSource(stream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            stream.getAudioTracks().forEach(tr => tr.addEventListener('ended', () => disableAudio()));
            say('听到了。', 2200);
            return;
        }
    } catch (e) { /* 用户取消或不允许 → 退化成只看网页内的音频 */ }
    say('那我先听听网页里的。', 2400);
}
function disableAudio() {
    audioMode = false;
    localStorage.setItem(LS_AUDIO, '0');
    audioBtn && audioBtn.classList.remove('on');
    try { audioStream && audioStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { audioCtx && audioCtx.close(); } catch (e) {}
    audioStream = null; audioCtx = null; analyser = null; soundActive = false;
    setEarphones(false);
}
function sampleAudio() {
    if (!audioMode) { setEarphones(false); return; }
    let level = 0;
    if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        level = sum / buf.length / 255;
    }
    soundLevel = level;
    const active = level > 0.035 || pageMediaPlaying();
    setEarphones(active);
}
function setEarphones(on) {
    soundActive = on;
    if (phones) phones.classList.toggle('show', on === true);
}

/* ---------- 主循环 ---------- */
function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (now % 400 < 20) sampleAudio();
    if (reduceMotion) return;

    if (phase === 'sit') {
        if (now >= sittingUntil) standUp();
        return;
    }
    if (phase === 'walk') {
        walkedMs += dt * 1000;
        const dx = target.x - pos.x, dy = target.y - pos.y;
        const dist = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (dist <= step) {
            pos.x = target.x; pos.y = target.y;
            apply();
            if (walkedMs >= WALK_BEFORE_REST && !sitting) { sitDown(now); return; }
            phase = 'pause';
            phaseUntil = now + rand(PAUSE_MIN, PAUSE_MAX);
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
function sitDown(now) {
    sitting = true;
    phase = 'sit';
    walkedMs = 0;
    sittingUntil = now + rand(REST_MS_MIN, REST_MS_MAX);
    if (sofa) sofa.classList.add('show');
    if (viewer && viewer.setPaused) viewer.setPaused(true);
    say(SIT_LINES[(Math.random() * SIT_LINES.length) | 0], 2600);
}
function standUp() {
    sitting = false;
    phase = 'pause';
    phaseUntil = performance.now() + rand(600, 1600);
    if (sofa) sofa.classList.remove('show');
    if (viewer && viewer.setPaused) viewer.setPaused(false);
}

function onPointerUp(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (sitting) { standUp(); return; }
    if (viewer) viewer.playGesture('wave');
    say(WAVE_LINES[(Math.random() * WAVE_LINES.length) | 0]);
    if (Math.random() < 0.5) { target = pickTarget(); phase = 'walk'; }
}

/* ---------- 启动 ---------- */
function makeButton(id, label, title) {
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.textContent = label; b.title = title;
    document.body.appendChild(b);
    return b;
}
function buildDom() {
    wrap = document.createElement('div');
    wrap.id = 'n109-pet';
    wrap.innerHTML = `<div id="n109-pet-bubble"></div>
        <div id="n109-pet-sofa">${SOFA_SVG}</div>
        <div id="n109-pet-phones">${earphoneSvg(earphone)}</div>
        <canvas id="n109-pet-canvas"></canvas>`;
    document.body.appendChild(wrap);
    bubble = wrap.querySelector('#n109-pet-bubble');
    sofa = wrap.querySelector('#n109-pet-sofa');
    phones = wrap.querySelector('#n109-pet-phones');
    canvas = wrap.querySelector('#n109-pet-canvas');

    toggle = makeButton('n109-pet-toggle', '🐾', '召唤 / 收起 Q版彻');
    toggle.addEventListener('click', () => setEnabled(!enabled));
    audioBtn = makeButton('n109-pet-audio', '🎧', '听声音：开启后小人会戴耳机（需要共享音频）');
    audioBtn.classList.toggle('on', audioMode);
    audioBtn.addEventListener('click', () => { audioMode ? disableAudio() : enableAudio(); });
    earBtn = makeButton('n109-pet-ear', '🔴', '切换耳机颜色（红 / 黑）');
    earBtn.addEventListener('click', () => {
        earphone = earphone === 'red' ? 'black' : 'red';
        localStorage.setItem(LS_EAR, earphone);
        renderEarphone();
        earBtn.textContent = earphone === 'red' ? '🔴' : '⚫';
        say(earphone === 'red' ? '红色，也行。' : '黑色更顺眼。', 2000);
    });
    earBtn.textContent = earphone === 'red' ? '🔴' : '⚫';
}

async function boot() {
    if (started) return;
    started = true;
    if (!wrap) buildDom();

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
        baseScale = viewer.modelPivot ? viewer.modelPivot.scale.x : 1;
        // 在 viewer 摆完骨之后、真正绘制之前，叠加我们的动作
        if (viewer.renderer && viewer.renderer.render) {
            const raw = viewer.renderer.render.bind(viewer.renderer);
            viewer.renderer.render = (scene, camera) => {
                decorate(performance.now() / 1000);
                raw(scene, camera);
            };
        }
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
        if (document.hidden || phase !== 'pause' || sitting) return;
        if (Math.random() < 0.35) say(LINES[(Math.random() * LINES.length) | 0], 4200);
    }, 45000);

    last = 0;
    raf = requestAnimationFrame(tick);
}

let enabled = true;
function setEnabled(on) {
    enabled = on;
    localStorage.setItem(LS_OFF, on ? '0' : '1');
    [toggle, audioBtn, earBtn].forEach(b => b && b.classList.toggle('hidden-btn', !on));
    if (on) {
        wrap.classList.remove('hidden');
        if (!started || !viewer) boot(); else { last = 0; if (!raf) raf = requestAnimationFrame(tick); }
    } else {
        wrap.classList.add('hidden');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (viewer && viewer.dispose) {
            try { viewer.dispose(); } catch (e) {}
            viewer = null; started = false; sitting = false;
            wrap.innerHTML = `<div id="n109-pet-bubble"></div>
                <div id="n109-pet-sofa">${SOFA_SVG}</div>
                <div id="n109-pet-phones">${earphoneSvg(earphone)}</div>
                <canvas id="n109-pet-canvas"></canvas>`;
            bubble = wrap.querySelector('#n109-pet-bubble');
            sofa = wrap.querySelector('#n109-pet-sofa');
            phones = wrap.querySelector('#n109-pet-phones');
            canvas = wrap.querySelector('#n109-pet-canvas');
        }
    }
}

function schedule() {
    if (localStorage.getItem(LS_OFF) === '1') {
        wrap = document.createElement('div');
        wrap.id = 'n109-pet'; wrap.classList.add('hidden');
        wrap.innerHTML = `<div id="n109-pet-bubble"></div>
            <div id="n109-pet-sofa">${SOFA_SVG}</div>
            <div id="n109-pet-phones">${earphoneSvg(earphone)}</div>
            <canvas id="n109-pet-canvas"></canvas>`;
        document.body.appendChild(wrap);
        bubble = wrap.querySelector('#n109-pet-bubble');
        sofa = wrap.querySelector('#n109-pet-sofa');
        phones = wrap.querySelector('#n109-pet-phones');
        canvas = wrap.querySelector('#n109-pet-canvas');
        toggle = makeButton('n109-pet-toggle', '🐾', '召唤 / 收起 Q版彻');
        toggle.classList.add('hidden-btn');
        audioBtn = makeButton('n109-pet-audio', '🎧', '听声音'); audioBtn.classList.add('hidden-btn');
        earBtn = makeButton('n109-pet-ear', earphone === 'red' ? '🔴' : '⚫', '切换耳机颜色'); earBtn.classList.add('hidden-btn');
        toggle.addEventListener('click', () => setEnabled(true));
        audioBtn.addEventListener('click', () => { audioMode ? disableAudio() : enableAudio(); });
        earBtn.addEventListener('click', () => {
            earphone = earphone === 'red' ? 'black' : 'red';
            localStorage.setItem(LS_EAR, earphone);
            renderEarphone();
            earBtn.textContent = earphone === 'red' ? '🔴' : '⚫';
        });
        return;
    }
    const run = () => boot();
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 1200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
else schedule();
/* 调试钩子（也方便以后扩展：控制台里可用 window.__n109Pet 调）
   window.__n109Pet.sit() / .stand() / .phones(true) / .walkTo(0.5,0.8,true) */
window.__n109Pet = {
    sit: () => sitDown(performance.now()),
    stand: () => standUp(),
    phones: (on) => setEarphones(!!on),
    walkTo: (rx, ry, force) => {
        const s = size();
        target = { x: clamp(rx * (innerWidth - s.w), 0, innerWidth - s.w), y: clamp(ry * (innerHeight - s.h), 0, innerHeight - s.h) };
        if (force) { phase = 'walk'; }
        return target;
    },
    state: () => ({ phase, sitting, soundActive, earphone, walkedMs: Math.round(walkedMs), pos, target }),
    sitY: (v) => { sitOffsetY = v; },
    sitRX: (v) => { sitOffsetX = v; },
    sitScale: (v) => { sitScaleMul = v; },
    boneNames: () => viewer && viewer.bones ? viewer.bones.map(b => b.name).filter(n => n && n !== '') : [],
    test: (name, x, y, z) => { testOps.push({ name, x, y, z }); return true; },
    clearTest: () => { testOps.length = 0; },
    info: () => viewer ? ({ hasViewer: true, motion: viewer.motion, hasSetMotion: typeof viewer.setMotion, hasRenderer: !!viewer.renderer, hasPivot: !!viewer.modelPivot, restSize: viewer.boneRest ? viewer.boneRest.size : -1, boneKeys: viewer.boneMap ? Object.keys(viewer.boneMap).filter(k => viewer.boneMap[k]).length : -1, chairVisible: viewer.chair ? viewer.chair.visible : null, pivotY: viewer.modelPivot ? +viewer.modelPivot.position.y.toFixed(2) : null }) : ({ hasViewer: false })
};