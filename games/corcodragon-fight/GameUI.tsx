/**
 * 《鳄龙咆哮》3D 客户端（Three.js，第一人称）。
 *
 * 分层：
 * - FpsGameView：纯渲染/HUD 组件，通过 FpsDriver 与「本地引擎」或「联机 socket」解耦；
 * - CorcodragonFightLocalScreen：本地 vs AI（浏览器内直接 tick 引擎）；
 * - CorcodragonFightDetailScreen：大厅详情/配置页。
 * 联机 driver 在 apps/web 的 useRealtimeGame 中实现，不放在本包（避免循环依赖）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { chooseAIInputs } from './ai';
import { CorcodragonFightEngine } from './engine';
import { SfxPlayer } from './fx';
import { heroModelPlacement } from './heroModel';
import { BALANCE, balanceToJson, resetBalance } from './balance';
import { sampleRemote, type RemoteSample } from './interp';
import {
  ARENA_HALF,
  EYE_Y,
  HERO_DEFS,
  HERO_IDS,
  HERO_LIST,
  WEAPON_DEFS,
  WEAPON_IDS,
  WALL_HEIGHT,
  viewRelativeMove,
} from './defs';
import type {
  AABB,
  AIStyle,
  AILevel,
  GameModeKind,
  HeroId,
  RealtimeInputAction,
  Snapshot,
  SnapshotEffect,
  SnapshotPlayer,
  WeaponId,
} from './defs';
import './game.css';

// ---------------- 颜色与常量 ----------------

const HERO_COLORS: Record<HeroId, number> = {
  yanren: 0xff6a3d,
  yingxiao: 0x9b5cff,
  tiebi: 0x3d8cff,
  lingyin: 0x3dd68c,
  guilei: 0xffcc33,
};
const TEAM_COLORS = { A: 0xff7a45, B: 0x4da3ff };

/** 训练场默认靶位：固定圆靶 / 移动圆靶 / 固定人靶 / 移动人靶（放在无掩体走廊内） */
const TRAINING_TARGETS = [
  { id: 'round-fixed', kind: 'round', pattern: 'fixed', pos: { x: -5, y: 0, z: -4 }, hp: 1, radius: 0.8 },
  { id: 'round-moving', kind: 'round', pattern: 'osc', pos: { x: -5, y: 0, z: -4 }, hp: 1, radius: 0.8, range: 7, speed: 1.1 },
  { id: 'human-fixed', kind: 'human', pattern: 'fixed', pos: { x: 15, y: 0, z: -12 }, hp: 100, range: 0, speed: 0.7 },
  { id: 'human-moving', kind: 'human', pattern: 'patrol', pos: { x: 15, y: 0, z: -12 }, hp: 100, range: 7, speed: 0.7 },
] as const;

function heroColor(hero: HeroId | null, team: string): number {
  if (hero) return HERO_COLORS[hero];
  return team === 'B' ? TEAM_COLORS.B : TEAM_COLORS.A;
}

/** 画质偏好：?quality=low(流畅优先) / high(画质优先)；缺省=自动 */
function qualityMode(): 'auto' | 'low' | 'high' {
  if (typeof window === 'undefined') return 'auto';
  const q = new URLSearchParams(window.location.search).get('quality');
  return q === 'low' ? 'low' : q === 'high' ? 'high' : 'auto';
}

/** 与渲染器一致的阴影开关（low 强制关、high 强制开、auto 读配置） */
function qualityShadows(): boolean {
  const q = qualityMode();
  if (q === 'high') return true;
  if (q === 'low') return false;
  return BALANCE.client.shadows;
}

/** Kenney Blaster Kit（CC0）第一人称枪模：GLB 文件名 + 枪口本地坐标 */
const GUN_GLB: Partial<Record<WeaponId, { file: string; muzzle: THREE.Vector3 }>> = {
  rifle: { file: 'blaster-a.glb', muzzle: new THREE.Vector3(0.22, -0.14, -1.0) },
  sniper: { file: 'blaster-e.glb', muzzle: new THREE.Vector3(0.22, -0.14, -1.32) },
  pistol: { file: 'blaster-h.glb', muzzle: new THREE.Vector3(0.22, -0.14, -0.66) },
  dagger: { file: '', muzzle: new THREE.Vector3(0.22, -0.14, -0.6) },
};

/** KayKit Adventurers（CC0）英雄视觉模型：只换外观，引擎胶囊碰撞箱不变 */
const HERO_GLB: Record<HeroId, { file: string; targetHeight: number }> = {
  yanren: { file: 'hero-barbarian.glb', targetHeight: 1.85 },
  yingxiao: { file: 'hero-rogue-hooded.glb', targetHeight: 1.85 },
  tiebi: { file: 'hero-knight.glb', targetHeight: 1.85 },
  lingyin: { file: 'hero-mage.glb', targetHeight: 1.85 },
  guilei: { file: 'hero-rogue.glb', targetHeight: 1.85 },
};

const characterModelCache = new Map<string, Promise<THREE.Group>>();

function loadHeroCharacter(hero: HeroId): Promise<THREE.Group> {
  const spec = HERO_GLB[hero];
  const cached = characterModelCache.get(spec.file);
  if (cached) return cached;
  const url = new URL(`./assets/models/characters/${spec.file}`, import.meta.url).href;
  const promise = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
  characterModelCache.set(spec.file, promise);
  return promise;
}

async function attachHeroModel(holder: THREE.Group, hero: HeroId): Promise<void> {
  const spec = HERO_GLB[hero];
  if (!spec) return;
  try {
    const source = await loadHeroCharacter(hero);
    // 共享材质，克隆节点树；用身体核心 AABB（而非整树 AABB）归一高度并中心对齐，
    // 避免武器/盾牌/法杖/帽子把角色视觉中心带偏，使模型与引擎胶囊碰撞盒一致。
    const model = source.clone();
    const placement = heroModelPlacement(model, spec.targetHeight);
    model.scale.setScalar(placement.scale);
    model.position.set(placement.x, placement.y, placement.z);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = qualityShadows();
        m.receiveShadow = qualityShadows();
      }
    });
    for (const child of [...holder.children]) {
      holder.remove(child);
      disposeObject(child);
    }
    holder.add(model);
  } catch {
    // 加载失败保留程序化胶囊人
  }
}

function loadWeaponGltf(group: THREE.Group, weapon: WeaponId, muzzle: THREE.Mesh): void {
  const spec = GUN_GLB[weapon];
  if (!spec?.file) return;
  const url = new URL(`./assets/models/${spec.file}`, import.meta.url).href;
  // 镜头内枪模：更近、稍放大（v0.2 反馈步枪偏大，步枪下调一档）
  const targetLen = weapon === 'sniper' ? 1.12 : weapon === 'rifle' ? 0.78 : 0.62;
  new GLTFLoader().load(
    url,
    (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const s = targetLen / Math.max(size.z, size.x, 0.01);
      model.scale.setScalar(s);
      const center = new THREE.Vector3();
      bounds.getCenter(center);
      // 只做一次 z 定位：模型中心放在枪组原点，root 统一控制镜头内位置，
      // 避免 loadWeaponGltf 的 -0.55 与渲染循环的 -0.55 双重偏移。
      model.position.set(-center.x * s, -0.24 - bounds.min.y * s, -center.z * s);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = false;
      });
      for (const child of [...group.children]) {
        if (child === muzzle) continue;
        group.remove(child);
        disposeObject(child);
      }
      group.add(model);
      // 枪口火光对准模型最远端的枪口（Kenney Blaster 模型长轴 +z，枪口在 -z 端）
      muzzle.position.set(
        center.x * s + model.position.x,
        center.y * s + model.position.y,
        bounds.min.z * s + model.position.z - 0.02,
      );
      group.userData.gltfReady = true;
      group.userData.muzzlePos = muzzle.position.clone();
    },
    undefined,
    () => {
      // 加载失败：保留程序化枪模
    },
  );
}

interface PlayerRender {
  group: THREE.Group;
  label: THREE.Sprite;
  shield: THREE.Mesh;
  wall: THREE.Mesh;
  ring?: THREE.Mesh;
  /** 按服务端时间戳排列的位置样本（插值缓冲，最多 32 个） */
  samples: RemoteSample[];
  alive: boolean;
  visible: boolean;
  shieldVal: number;
  hero: HeroId | null;
}

interface Tracer {
  line: THREE.Line;
  born: number;
}

// ---------------- 通用驱动契约 ----------------

export interface FpsDriver {
  snapshot: Snapshot | null;
  /** 联机：每帧可读的最新快照（不经节流渲染管线）；本地驱动可省略 */
  snapshotRef?: { current: Snapshot | null };
  myId: string | null;
  online: boolean;
  error: string | null;
  send: (input: RealtimeInputAction) => void;
  onExit: () => void;
  onRestart?: () => void;
  /** 联机统计（联机 hook 提供；本地驱动省略） */
  stats?: { pingMs: number; pendingInputs: number };
  /** 是否开启音效（鳄龙咆哮专属偏好） */
  sound?: boolean;
  /** 是否开启打击特效（火光/弹道/火花等） */
  fx?: boolean;
}

export interface FightConfig {
  mode: GameModeKind;
  scoreLimit: number;
  /** 服务端同步频率（Hz）：20/30/60 */
  tickHz: number;
  /** 复活时长（毫秒） */
  respawnMs: number;
  /** bot 行为：combat=实战 AI；movement=移动测试 AI（只走位不攻击） */
  aiStyle: AIStyle;
  /** bot 难度：easy 低命中/慢反应；normal；hard 高命中 */
  aiLevel: AILevel;
}

/** 鳄龙咆哮专属偏好（与出包魔法师 tm-settings 分离存储） */
export interface FightPrefs {
  sound: boolean;
  fx: boolean;
}

// ---------------- 3D 视图 + HUD ----------------

export function FpsGameView({ driver }: { driver: FpsDriver }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef(driver);
  driverRef.current = driver;
  const snapRef = useRef<Snapshot | null>(driver.snapshotRef?.current ?? driver.snapshot);
  snapRef.current = driver.snapshotRef?.current ?? driver.snapshot;
  /** 已送入远端插值缓冲的快照 seq */
  const lastRemoteSeqRef = useRef(-1);
  /** 客户端与服务端引擎时钟的偏移估计（EMA） */
  const netOffsetRef = useRef<number | null>(null);

  const [tuningEnabled] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('debug'),
  );

  const [locked, setLocked] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [hitAt, setHitAt] = useState(0);
  const [driftM, setDriftM] = useState(0);
  const [showColliders, setShowColliders] = useState(false);
  const emaDtRef = useRef(0);
  const frameCountRef = useRef(0);
  const fpsRef = useRef(0);
  const [fps, setFps] = useState(0);
  const [qualityNote, setQualityNote] = useState<string | null>(null);
  const [killFeed, setKillFeed] = useState<string[]>([]);

  // 视图/输入状态（本帧立即生效，再同步给引擎）
  const viewRef = useRef({ yaw: 0, pitch: 0, init: false });
  const keysRef = useRef<Record<string, boolean>>({});
  const localPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const lastMoveRef = useRef({ x: 0, z: 0 });
  const lastLookSentRef = useRef(0);
  const lastMoveSentRef = useRef(0);
  const lastAliveRef = useRef(false);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const worldBuiltRef = useRef(false);
  const arenaRef = useRef<{ half: number; obstacles: AABB[] } | null>(null);
  const playerRendersRef = useRef(new Map<string, PlayerRender>());
  const effectMeshesRef = useRef(new Map<number, THREE.Object3D>());
  const tracerRef = useRef<Tracer[]>([]);
  const bombTrailsRef = useRef(
    new Map<number, { line: THREE.Line; dots: THREE.Mesh[]; pts: THREE.Vector3[]; last: number }>(),
  );
  const gunRef = useRef<THREE.Group | null>(null);
  const muzzleRef = useRef<THREE.Mesh | null>(null);
  const selfWallRef = useRef<THREE.Mesh | null>(null);
  const muzzleBornRef = useRef(-1);
  const clockRef = useRef(new THREE.Clock());
  const sfxRef = useRef<SfxPlayer | null>(null);
  const muzzleLightRef = useRef<THREE.PointLight | null>(null);
  const gunRecoilRef = useRef(0);
  const meleeSwingRef = useRef(-1);
  const slashRefs = useRef<{ mesh: THREE.Mesh; born: number }[]>([]);
  const prevReloadingRef = useRef(false);
  const stepAccRef = useRef(0);
  const sparksRef = useRef<{ mesh: THREE.Mesh; vel: THREE.Vector3; born: number; life: number }[]>([]);
  const dustRef = useRef<THREE.Points | null>(null);
  const crosshairRef = useRef<HTMLDivElement | null>(null);
  const colliderGroupRef = useRef<THREE.Group | null>(null);
  const pendingAimRef = useRef<'skill' | 'ult' | null>(null);
  const playerCollidersRef = useRef(new Map<string, THREE.Mesh>());
  const colliderShapeRef = useRef('');
  const [killFlash, setKillFlash] = useState<{ text: string; at: number } | null>(null);
  const [hitFlash, setHitFlash] = useState<{
    amount: number;
    kind: 'dealt' | 'taken';
    headshot: boolean;
    at: number;
  } | null>(null);

  const getSfx = useCallback(() => {
    if (!sfxRef.current) sfxRef.current = new SfxPlayer();
    return sfxRef.current;
  }, []);

  useEffect(() => {
    if (sfxRef.current) sfxRef.current.enabled = driver.sound !== false;
  }, [driver.sound]);

  const spawnSparks = useCallback((pos: { x: number; y: number; z: number }, color: number, count = 7) => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.TetrahedronGeometry(0.035 + Math.random() * 0.03);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, Math.max(0.05, pos.y), pos.z);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2,
        Math.random() * 2.6 + 0.6,
        (Math.random() - 0.5) * 3.2,
      );
      scene.add(mesh);
      sparksRef.current.push({ mesh, vel, born: performance.now(), life: 0.3 + Math.random() * 0.2 });
    }
  }, []);

  // ---- 静态 3D 世界 ----
  const buildWorld = useCallback((snap: Snapshot) => {
    const host = hostRef.current;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!host || !scene || !renderer) return;
    // 竞技场只在首次快照下发：缺失时用缓存
    const arena = snap.arena ?? arenaRef.current;
    if (!arena) return;
    arenaRef.current = arena;
    const hostRect = host.getBoundingClientRect();
    const camera = new THREE.PerspectiveCamera(
      75,
      Math.max(0.5, hostRect.width / Math.max(1, hostRect.height)),
      0.08,
      220,
    );
    camera.rotation.order = 'YXZ';
    cameraRef.current = camera;
    const muzzleLight = new THREE.PointLight(0xffc36b, 0, 7);
    muzzleLight.position.set(0.24, -0.2, -0.9);
    camera.add(muzzleLight);
    muzzleLightRef.current = muzzleLight;
    scene.add(camera);

    scene.background = new THREE.Color(0x16202e);
    scene.fog = new THREE.Fog(0x16202e, 48, 130);
    const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x2a3648, 1.7);
    const sun = new THREE.DirectionalLight(0xffffff, 3.0);
    sun.position.set(20, 30, 14);
    sun.castShadow = qualityShadows();
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.far = 90;
    scene.add(hemi, sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8),
      new THREE.MeshStandardMaterial({ color: 0x3b475c, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = qualityShadows();
    scene.add(floor);
    const grid = new THREE.GridHelper(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8, 0x61789c, 0x34405a);
    grid.position.y = 0.02;
    scene.add(grid);

    const boxMat = new THREE.MeshStandardMaterial({ color: 0xa5805e, roughness: 0.9 });
    const crateVariants = ['small', 'small', 'medium', 'medium', 'medium', 'wide', 'wide'];
    const gltfLoader = new GLTFLoader();
    arena.obstacles.forEach((b, idx) => {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, b.height, d), boxMat);
      mesh.position.set(cx, b.height / 2, cz);
      mesh.castShadow = qualityShadows();
      mesh.receiveShadow = qualityShadows();
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0xff9a4d, transparent: true, opacity: 0.35 }),
      );
      mesh.add(edge);
      scene.add(mesh);

      // Kenney Blaster Kit（CC0）木箱模型：加载成功后替换占位盒，失败保留占位
      const crate = crateVariants[idx % crateVariants.length];
      const crateUrl = new URL(`./assets/models/crate-${crate}.glb`, import.meta.url).href;
      gltfLoader.load(
        crateUrl,
        (gltf) => {
          const model = gltf.scene;
          const bounds = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          bounds.getSize(size);
          // 按碰撞盒实际尺寸逐轴拉伸，模型外沿与物理盒一致（视觉=碰撞）
          const targetW = w * 0.98;
          const targetH = b.height * 0.98;
          const targetD = d * 0.98;
          const sx = size.x > 0.01 ? targetW / size.x : 1;
          const sy = size.y > 0.01 ? targetH / size.y : 1;
          const sz = size.z > 0.01 ? targetD / size.z : 1;
          model.scale.set(sx, sy, sz);
          // 底部贴地、中心对准碰撞盒中心
          model.position.set(
            cx - (bounds.min.x + size.x / 2) * sx,
            -bounds.min.y * sy,
            cz - (bounds.min.z + size.z / 2) * sz,
          );
          model.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = qualityShadows();
              m.receiveShadow = qualityShadows();
            }
          });
          scene.add(model);
          mesh.visible = false;
        },
        undefined,
        () => {
          // 加载失败：保留程序化占位盒（console.warn 一次即可）
        },
      );
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4e6183, roughness: 0.85 });
    const wallDefs = [
      { w: ARENA_HALF * 2 + 9, d: 1, x: 0, z: ARENA_HALF + 0.5 },
      { w: ARENA_HALF * 2 + 9, d: 1, x: 0, z: -ARENA_HALF - 0.5 },
      { w: 1, d: ARENA_HALF * 2 + 9, x: ARENA_HALF + 0.5, z: 0 },
      { w: 1, d: ARENA_HALF * 2 + 9, x: -ARENA_HALF - 0.5, z: 0 },
    ];
    for (const w of wallDefs) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_HEIGHT + 1, w.d), wallMat);
      mesh.position.set(w.x, (WALL_HEIGHT + 1) / 2, w.z);
      mesh.castShadow = qualityShadows();
      mesh.receiveShadow = qualityShadows();
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x57c7ff, transparent: true, opacity: 0.4 }),
      );
      mesh.add(edge);
      scene.add(mesh);
    }

    // 环境尘埃粒子（氛围）
    const dustCount = qualityMode() === 'low' ? 0 : 160;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() * 2 - 1) * (ARENA_HALF + 2);
      dustPos[i * 3 + 1] = Math.random() * 4.5;
      dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * (ARENA_HALF + 2);
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0x9fc7ff,
        size: 0.04,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    dustRef.current = dust;
    scene.add(dust);

    worldBuiltRef.current = true;
  }, []);

  // ---- 初始化渲染器 ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({
      antialias: qualityMode() === 'high' ? true : BALANCE.client.antialias,
      powerPreference: 'high-performance',
    });
    const q = qualityMode();
    const targetRatio =
      q === 'low' ? 0.75 : q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : BALANCE.client.maxPixelRatio;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, targetRatio));
    renderer.shadowMap.enabled = q === 'high' ? true : q === 'low' ? false : BALANCE.client.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    canvasRef.current = renderer.domElement;
    rendererRef.current = renderer;
    sceneRef.current = new THREE.Scene();

    const resize = () => {
      const r = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
      const cam = cameraRef.current;
      if (cam) {
        cam.aspect = Math.max(0.5, r.width / Math.max(1, r.height));
        cam.updateProjectionMatrix();
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(BALANCE.client.maxDeltaMs / 1000, clockRef.current.getDelta());
      // 自适应画质：连续低帧率时自动关阴影/降像素比，优先保证流畅
      const dtMs = dt * 1000;
      emaDtRef.current = emaDtRef.current === 0 ? dtMs : emaDtRef.current * 0.95 + dtMs * 0.05;
      frameCountRef.current += 1;
      if (dtMs > 0) {
        fpsRef.current = fpsRef.current === 0 ? 1000 / dtMs : fpsRef.current * 0.9 + (1000 / dtMs) * 0.1;
        if (frameCountRef.current % 60 === 0) setFps(Math.round(fpsRef.current));
      }
      if (
        BALANCE.client.autoQuality &&
        frameCountRef.current % 240 === 0 &&
        emaDtRef.current > 25
      ) {
        if (renderer.shadowMap.enabled) {
          renderer.shadowMap.enabled = false;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
          setQualityNote('已自动降低画质（关闭阴影）以保持流畅');
        } else if (renderer.getPixelRatio() > 0.8) {
          renderer.setPixelRatio(0.8);
          setQualityNote('已自动降低分辨率以保持流畅');
        }
      }
      // 联机：每帧直接读最新快照（快照接收频率高于 HUD 的节流渲染频率）
      const liveSnap = driverRef.current.snapshotRef?.current ?? driverRef.current.snapshot;
      if (liveSnap !== snapRef.current) snapRef.current = liveSnap;
      const snap = snapRef.current;
      // 远端插值缓冲：每个新快照立刻采样，不等 React 渲染
      if (snap && snap.seq !== lastRemoteSeqRef.current) {
        lastRemoteSeqRef.current = snap.seq;
        const recvAt = performance.now();
        if (netOffsetRef.current === null) {
          netOffsetRef.current = recvAt - snap.t;
        } else {
          netOffsetRef.current = netOffsetRef.current * 0.9 + (recvAt - snap.t) * 0.1;
        }
        for (const p of snap.players) {
          if (p.id === driverRef.current.myId) continue;
          const pr = playerRendersRef.current.get(p.id);
          if (!pr) continue;
          if (!p.visible) {
            pr.samples.length = 0;
            continue;
          }
          const s = pr.samples;
          if (s.length && snap.t <= s[s.length - 1].t) continue;
          s.push({ t: snap.t, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw });
          if (s.length > 32) s.shift();
        }
      }
      const me = snap?.players.find((p) => p.id === driverRef.current.myId) ?? null;
      const cam = cameraRef.current;
      const scene = sceneRef.current;
      if (!scene || !cam || !renderer) return;

      if (me && me.alive && snap?.phase === 'playing' && locked) {
        const hero = me.hero ? HERO_DEFS[me.hero] : HERO_DEFS.yanren;
        let speed = hero.speed;
        if (me.ads) speed *= 0.5;
        if (me.stealthT > 0) speed *= 1.25;
        const k = keysRef.current;
        const mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
        const mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
        const dir = viewRelativeMove(viewRef.current.yaw, mx, mz);
        localPosRef.current.x += dir.x * speed * dt;
        localPosRef.current.z += dir.z * speed * dt;
        if (me.onGround && driverRef.current.sound !== false) {
          stepAccRef.current += speed * dt;
          if (stepAccRef.current > 2.6) {
            stepAccRef.current = 0;
            getSfx().step();
          }
        } else {
          stepAccRef.current = 0;
        }
      }
      if (me) {
        const target = new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z);
        const k2 = driverRef.current.online
          ? BALANCE.client.correctionRate
          : BALANCE.client.interpolationRate;
        localPosRef.current.lerp(target, Math.min(1, k2 * dt));
      }
      if (cam) {
        const bob =
          me && me.alive && (keysRef.current.KeyW || keysRef.current.KeyA || keysRef.current.KeyS || keysRef.current.KeyD)
            ? Math.sin(performance.now() / 110) * 0.025
            : 0;
        cam.position.set(
          localPosRef.current.x,
          localPosRef.current.y + EYE_Y + bob,
          localPosRef.current.z,
        );
        // Three.js 相机默认朝 -z；引擎视角约定 yaw=0 朝 +z，因此补偿 π
        cam.rotation.y = viewRef.current.yaw + Math.PI;
        cam.rotation.x = viewRef.current.pitch;
        // 开镜真实生效：FOV 向武器 adsFov 平滑过渡（狙击枪进入镜内视野）
        const wdef = me ? WEAPON_DEFS[me.weapon] : null;
        const targetFov = me?.ads && wdef && !wdef.melee ? wdef.adsFov : 75;
        if (Math.abs(cam.fov - targetFov) > 0.05) {
          cam.fov += (targetFov - cam.fov) * Math.min(1, 14 * dt);
          cam.updateProjectionMatrix();
        }
      }

      // 自己的铁壁能量墙：与第一人称视角每帧实时同步（视线转动即转动）
      if (scene) {
        const wallOn = me?.hero === 'tiebi' && me.alive && me.shield > 0;
        if (wallOn) {
          if (!selfWallRef.current) {
            selfWallRef.current = makeShieldWallMesh();
            scene.add(selfWallRef.current);
          }
          const wall = selfWallRef.current;
          const yaw = viewRef.current.init ? viewRef.current.yaw : me.yaw;
          const fw = { x: Math.sin(yaw), z: Math.cos(yaw) };
          const dist = BALANCE.heroes.tiebi.ability.shieldDistance ?? 1.8;
          const centerY = (BALANCE.heroes.tiebi.ability.shieldCenterY ?? 1.2) + localPosRef.current.y;
          const width = BALANCE.heroes.tiebi.ability.shieldWidth ?? 4.8;
          const height = BALANCE.heroes.tiebi.ability.shieldHeight ?? 3;
          wall.position.set(
            localPosRef.current.x + fw.x * dist,
            centerY,
            localPosRef.current.z + fw.z * dist,
          );
          wall.rotation.y = yaw;
          wall.scale.set(width, height, 1);
          wall.visible = true;
          const mat = wall.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.28 + Math.sin(performance.now() / 180) * 0.05;
        } else if (selfWallRef.current) {
          selfWallRef.current.visible = false;
        }
      }

      // 其他玩家平滑插值：按服务端时间戳渲染 90ms 前的状态（快照插值缓冲），
      // 到达间隔抖动只影响缓冲深度，不再用墙钟速度外推造成跳变
      const nowMs = performance.now();
      for (const [id, pr] of playerRendersRef.current) {
        if (id === driverRef.current.myId) continue;
        pr.group.visible = pr.visible && pr.alive;
        if (!pr.visible || !pr.alive) continue;
        const renderT = nowMs - (netOffsetRef.current ?? 0) - BALANCE.client.interpolationBufferMs;
        const out = sampleRemote(pr.samples, renderT);
        if (!out) continue;
        pr.group.position.set(out.x, out.y, out.z);
        pr.group.rotation.y = out.yaw;
        const wallOn = pr.shieldVal > 0 && pr.hero === 'tiebi';
        pr.wall.visible = wallOn;
        pr.shield.visible = pr.shieldVal > 0 && pr.hero !== 'tiebi';
        if (wallOn) {
          const width = BALANCE.heroes.tiebi.ability.shieldWidth ?? 4.8;
          const height = BALANCE.heroes.tiebi.ability.shieldHeight ?? 3;
          pr.wall.scale.set(width, height, 1);
          const mat = pr.wall.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.3 + Math.sin(nowMs / 180) * 0.05;
        }
        if (pr.shield.visible) {
          const s = 1.1 + Math.sin(nowMs / 180) * 0.04;
          pr.shield.scale.setScalar(s);
        }
      }

      // 特效
      const now = performance.now();
      for (const [id, mesh] of effectMeshesRef.current) {
        const eff = snap?.effects.find((e) => e.id === id);
        if (!eff) continue;
        const frac = Math.max(0, Math.min(1, eff.t / Math.max(0.001, eff.duration)));
        const targetPos = new THREE.Vector3(eff.pos.x, Math.max(0.03, eff.pos.y), eff.pos.z);
        // 炸弹抛体：插值平滑，呈现连续抛物线
        if (eff.kind === 'bomb') {
          mesh.position.lerp(targetPos, Math.min(1, BALANCE.client.interpolationRate * dt));
        } else {
          mesh.position.copy(targetPos);
        }
        const mat = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (mat && 'opacity' in mat) {
          if (eff.kind === 'explosion') {
            mesh.scale.setScalar(0.6 + (1 - frac) * eff.radius * 0.9);
            mat.opacity = Math.max(0, frac) * 0.9;
          } else if (eff.kind === 'ultRing') {
            const pulse = 1 + Math.sin(now / 90) * 0.04;
            mesh.scale.setScalar(pulse);
            mat.opacity = Math.max(0, frac) * 0.85;
          } else if (eff.kind === 'fireTrail' || eff.kind === 'stormZone') {
            mat.opacity = Math.max(0, frac) * 0.55;
            mesh.rotation.z = now / 500;
          } else if (eff.kind === 'healZone') {
            mat.opacity = Math.max(0, frac) * 0.35 + Math.sin(now / 150) * 0.06;
          } else if (eff.kind === 'healWave') {
            mat.opacity = Math.max(0, frac) * 0.5;
          } else {
            mat.opacity = Math.max(0, frac);
          }
        }
      }

      // 炸弹抛物线轨迹：保留最近 14 个插值点，形成可见弧线 + 渐隐光点
      const bombIds = new Set<number>();
      for (const eff of snap?.effects ?? []) if (eff.kind === 'bomb') bombIds.add(eff.id);
      for (const [id, tr] of bombTrailsRef.current) {
        if (bombIds.has(id)) continue;
        scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        for (const dot of tr.dots) {
          scene.remove(dot);
          dot.geometry.dispose();
          (dot.material as THREE.Material).dispose();
        }
        bombTrailsRef.current.delete(id);
      }
      for (const eff of snap?.effects ?? []) {
        if (eff.kind !== 'bomb') continue;
        const mesh = effectMeshesRef.current.get(eff.id);
        if (!mesh) continue;
        let tr = bombTrailsRef.current.get(eff.id);
        if (!tr) {
          const geo = new THREE.BufferGeometry().setFromPoints([mesh.position.clone()]);
          const line = new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({
              color: 0xffb45a,
              transparent: true,
              opacity: 0.95,
              depthWrite: false,
            }),
          );
          line.frustumCulled = false;
          scene.add(line);
          tr = { line, dots: [], pts: [mesh.position.clone()], last: now };
          bombTrailsRef.current.set(eff.id, tr);
        }
        if (now - tr.last >= 40) {
          tr.last = now;
          tr.pts.push(mesh.position.clone());
          if (tr.pts.length > 14) tr.pts.shift();
          tr.line.geometry.dispose();
          tr.line.geometry = new THREE.BufferGeometry().setFromPoints(tr.pts);
          // 历史点渲染为渐隐光球，让抛物线在远处也清晰可辨
          for (const dot of tr.dots) {
            scene.remove(dot);
            dot.geometry.dispose();
            (dot.material as THREE.Material).dispose();
          }
          tr.dots = tr.pts.slice(0, -1).map((p, i) => {
            const frac = (i + 1) / Math.max(1, tr.pts.length);
            const dot = new THREE.Mesh(
              new THREE.SphereGeometry(0.12, 8, 6),
              new THREE.MeshBasicMaterial({
                color: 0xffb45a,
                transparent: true,
                opacity: 0.25 + frac * 0.6,
                depthWrite: false,
              }),
            );
            dot.position.copy(p);
            scene.add(dot);
            return dot;
          });
        }
      }

      // 弹道
      for (const tr of tracerRef.current) {
        const mat = (tr.line.material as THREE.LineBasicMaterial);
        mat.opacity = Math.max(0, 0.85 - (now - tr.born) / 120);
      }
      const expired = tracerRef.current.filter((t) => now - t.born >= 120);
      for (const tr of expired) {
        scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
      }
      tracerRef.current = tracerRef.current.filter((t) => now - t.born < 120);

      // 枪口火光与点光源
      const fxOn = driverRef.current.fx !== false;
      if (muzzleRef.current) {
        muzzleRef.current.visible = fxOn && now - muzzleBornRef.current < 70;
      }
      if (muzzleLightRef.current) {
        muzzleLightRef.current.intensity = fxOn && now - muzzleBornRef.current < 70 ? 4 : 0;
      }

      // 枪模后坐与呼吸摆动 / 匕首挥砍
      if (gunRef.current) {
        gunRecoilRef.current = Math.max(0, gunRecoilRef.current - dt * 4.5);
        const sway = Math.sin(now / 700) * 0.006;
        gunRef.current.position.set(0.24, -0.22 + sway, -0.36 - gunRecoilRef.current * 0.12);
        gunRef.current.rotation.x = gunRecoilRef.current * 0.55;
        const swingAge = (now - meleeSwingRef.current) / 1000;
        if (swingAge >= 0 && swingAge < 0.24) {
          const t = swingAge / 0.24;
          gunRef.current.rotation.y = Math.sin(t * Math.PI) * -1.1;
          gunRef.current.position.x = 0.24 - Math.sin(t * Math.PI) * 0.28;
        } else {
          gunRef.current.rotation.y = 0;
        }
      }

      // 挥砍弧光
      for (const sl of slashRefs.current) {
        const age = (now - sl.born) / 1000;
        const mat = sl.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.65 * (1 - age / 0.18));
      }
      const expiredSlash = slashRefs.current.filter((s) => (now - s.born) / 1000 >= 0.18);
      for (const s of expiredSlash) {
        scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
      }
      slashRefs.current = slashRefs.current.filter((s) => (now - s.born) / 1000 < 0.18);

      // 命中火花粒子
      for (const sp of sparksRef.current) {
        const age = (now - sp.born) / 1000;
        const mat = sp.mesh.material as THREE.MeshBasicMaterial;
        if (age >= sp.life) {
          scene.remove(sp.mesh);
          sp.mesh.geometry.dispose();
          mat.dispose();
          continue;
        }
        sp.vel.y -= 9.8 * dt;
        sp.mesh.position.addScaledVector(sp.vel, dt);
        mat.opacity = Math.max(0, 1 - age / sp.life);
      }
      sparksRef.current = sparksRef.current.filter((sp) => (performance.now() - sp.born) / 1000 < sp.life);

      if (dustRef.current) {
        dustRef.current.visible = fxOn;
        dustRef.current.rotation.y += dt * 0.02;
      }

      // 动态准星：随散布膨胀/移动/开火节奏扩张
      if (crosshairRef.current) {
        const k = keysRef.current;
        const moving = k.KeyW || k.KeyA || k.KeyS || k.KeyD;
        const gap =
          6 +
          (me?.spreadBloom ?? 0) * 320 +
          (moving ? 3 : 0) +
          ((me?.fireCd ?? 0) > 0 ? 4 : 0);
        crosshairRef.current.style.setProperty('--gap', `${gap.toFixed(1)}px`);
      }

      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneRef.current = null;
      rendererRef.current = null;
      worldBuiltRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 快照 → 场景对象 ----
  useEffect(() => {
    const snap = driver.snapshot;
    if (!snap) return;
    if (!worldBuiltRef.current) buildWorld(snap);
    const scene = sceneRef.current;
    const me = snap.players.find((p) => p.id === driver.myId);

    // 视角初始化/重生同步
    if (me && !viewRef.current.init) {
      viewRef.current = { yaw: me.yaw, pitch: me.pitch, init: true };
      localPosRef.current.set(me.pos.x, me.pos.y, me.pos.z);
      lastAliveRef.current = me.alive;
    }
    if (me && !lastAliveRef.current && me.alive) {
      viewRef.current.yaw = me.yaw;
      viewRef.current.pitch = me.pitch;
      localPosRef.current.set(me.pos.x, me.pos.y, me.pos.z);
    }
    if (me) lastAliveRef.current = me.alive;

    // 二段瞄准状态同步：服务器确认后清掉本地 pending；被拒绝/阵亡也清掉
    if (me) {
      const pending = pendingAimRef.current;
      if (pending === 'skill') {
        if (me.skillAim) pendingAimRef.current = null;
        else if (!me.alive || me.skillCd > 0) pendingAimRef.current = null;
      } else if (pending === 'ult') {
        if (me.ultAim) pendingAimRef.current = null;
        else if (!me.alive || me.ultCharge < 99) pendingAimRef.current = null;
      }
    }

    // 联机软校正：统计预测漂移；超过阈值立即吸附到服务端（回滚）
    if (driver.online && me) {
      const drift = Math.hypot(
        localPosRef.current.x - me.pos.x,
        localPosRef.current.z - me.pos.z,
      );
      if (drift > BALANCE.client.softCorrectionThreshold) {
        localPosRef.current.set(me.pos.x, me.pos.y, me.pos.z);
      }
      setDriftM(drift);
    }

    // 其他玩家模型
    const myTeam = me?.team;
    for (const p of snap.players) {
      if (p.id === driver.myId) continue;
      let pr = playerRendersRef.current.get(p.id);
      if (!pr && scene) {
        const color = heroColor(p.hero, p.team);
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
        const group = new THREE.Group();
        if (p.targetKind === 'round') {
          // 圆形靶：白色靶面 + 双红环 + 支架
          const h = p.hitRadius * 2;
          const face = new THREE.Mesh(
            new THREE.CylinderGeometry(p.hitRadius, p.hitRadius, 0.12, 28),
            new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
          );
          face.position.y = 0.2 + h - 0.06;
          face.castShadow = qualityShadows();
          const ringMat = new THREE.MeshBasicMaterial({ color: 0xd83030 });
          const ring1 = new THREE.Mesh(new THREE.TorusGeometry(p.hitRadius * 0.55, 0.04, 8, 28), ringMat);
          const ring2 = new THREE.Mesh(new THREE.TorusGeometry(p.hitRadius * 0.18, 0.04, 8, 20), ringMat);
          ring1.position.y = face.position.y;
          ring2.position.y = face.position.y;
          const stand = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10),
            new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.6 }),
          );
          stand.position.y = 0.2;
          group.add(face, ring1, ring2, stand);
        } else if (p.targetKind === 'human') {
          // 人形靶：白色躯干 + 红头 + 胸口红心靶
          const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.55, 1.35, 12),
            new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.55 }),
          );
          body.position.y = 0.78;
          body.castShadow = qualityShadows();
          const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.38, 14, 10),
            new THREE.MeshStandardMaterial({ color: 0xc84545, roughness: 0.5 }),
          );
          head.position.y = 1.78;
          head.castShadow = qualityShadows();
          const bull = new THREE.Mesh(
            new THREE.TorusGeometry(0.16, 0.05, 8, 20),
            new THREE.MeshBasicMaterial({ color: 0xff3030 }),
          );
          bull.position.set(0, 1.3, 0.36);
          group.add(body, head, bull);
        } else {
          // 英雄玩家：先放程序化胶囊人作占位，异步替换为 KayKit CC0 角色模型
          const visual = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.35, 12), mat);
          body.position.y = 0.78;
          body.castShadow = qualityShadows();
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), mat);
          head.position.y = 1.78;
          head.castShadow = qualityShadows();
          const visor = new THREE.Mesh(
            new THREE.SphereGeometry(0.17, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xd7f4ff }),
          );
          visor.position.set(0, 1.78, 0.3);
          const stripe = new THREE.Mesh(
            new THREE.CylinderGeometry(0.51, 0.56, 0.16, 12),
            new THREE.MeshStandardMaterial({
              color: p.team === 'B' ? 0x2d6bff : 0xff5a3c,
              roughness: 0.5,
              emissive: p.team === 'B' ? 0x12233f : 0x3a1208,
              emissiveIntensity: 0.6,
            }),
          );
          stripe.position.y = 1.25;
          const handGun = new THREE.Mesh(
            new THREE.BoxGeometry(0.09, 0.09, 0.55),
            new THREE.MeshStandardMaterial({ color: 0x11151d, roughness: 0.4 }),
          );
          handGun.position.set(0.42, 1.15, 0.32);
          visual.add(body, head, visor, stripe, handGun);
          group.add(visual);
          if (p.hero) void attachHeroModel(visual, p.hero);
        }
        const shield = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({
            color: 0x3d9bff,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
          }),
        );
        shield.position.y = 1.0;
        shield.visible = false;
        group.add(shield);
        // 铁壁重做：视角正前方的大块能量墙（随 yaw 实时同步，替队友挡子弹）
        const wall = makeShieldWallMesh();
        wall.position.set(
          0,
          BALANCE.heroes.tiebi.ability.shieldCenterY ?? 1.2,
          BALANCE.heroes.tiebi.ability.shieldDistance ?? 1.8,
        );
        group.add(wall);
        const isAlly = snap.mode === 'tdm' && p.team === myTeam;
        const labelColor = snap.mode === 'tdm' ? (isAlly ? 0x5cffa0 : 0xff7a6b) : color;
        const label = makeNameSprite(`${isAlly ? '◈ ' : ''}${p.name}`, labelColor);
        // 关闭敌人 ID 视野：只显示训练场靶名与队友名字，敌人不显示 ID
        label.visible = snap.mode === 'training' || isAlly;
        group.add(label);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.64, 0.06, 8, 24),
          new THREE.MeshBasicMaterial({
            color: isAlly ? 0x5cffa0 : 0xff6b5e,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        ring.visible = snap.mode === 'tdm';
        group.add(ring);
        scene.add(group);
        pr = {
          group,
          label,
          shield,
          wall,
          ring,
          samples: p.visible ? [{ t: snap.t, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw }] : [],
          alive: p.alive,
          visible: p.visible,
          shieldVal: p.shield,
          hero: p.hero,
        };
        playerRendersRef.current.set(p.id, pr);
      }
      if (pr) {
        // 位置/朝向样本由渲染循环在收到每个快照时直接入队（见 rAF loop），
        // 这里只同步可见性/护盾/英雄等低频元数据。
        pr.alive = p.alive;
        pr.visible = p.visible;
        pr.shieldVal = p.shield;
        pr.hero = p.hero;
        if (!p.visible) pr.samples.length = 0;
        pr.wall.position.set(
          0,
          BALANCE.heroes.tiebi.ability.shieldCenterY ?? 1.2,
          BALANCE.heroes.tiebi.ability.shieldDistance ?? 1.8,
        );
        if (pr.ring) {
          const isAlly = snap.mode === 'tdm' && p.team === myTeam;
          pr.ring.visible = snap.mode === 'tdm' && p.visible && p.alive;
          (pr.ring.material as THREE.MeshBasicMaterial).color.set(isAlly ? 0x5cffa0 : 0xff6b5e);
          pr.label.visible = snap.mode === 'training' || isAlly;
        }
      }
    }

    // 特效对象
    if (scene) {
      const seen = new Set<number>();
      for (const eff of snap.effects) {
        seen.add(eff.id);
        let mesh = effectMeshesRef.current.get(eff.id);
        if (!mesh) {
          mesh = makeEffectMesh(eff);
          scene.add(mesh);
          effectMeshesRef.current.set(eff.id, mesh);
        }
      }
      for (const [id, mesh] of effectMeshesRef.current) {
        if (!seen.has(id)) {
          scene.remove(mesh);
          disposeObject(mesh);
          effectMeshesRef.current.delete(id);
        }
      }
    }

    // 枪模型
    if (me && scene && cameraRef.current) {
      if (gunRef.current?.userData.weapon !== me.weapon) {
        if (gunRef.current) {
          cameraRef.current.remove(gunRef.current);
          disposeObject(gunRef.current);
        }
        const gun = makeGun(me.weapon);
        gun.userData.weapon = me.weapon;
        gunRef.current = gun;
        muzzleRef.current = gun.userData.muzzle as THREE.Mesh;
        cameraRef.current.add(gun);
      }
      if (gunRef.current && muzzleRef.current) {
        const scoped = me.ads && me.weapon === 'sniper';
        gunRef.current.visible = me.alive && !scoped;
        muzzleRef.current.visible = false;
      }
    }

    // 换弹音效（状态跳变）
    if (me && me.reloading && !prevReloadingRef.current && driver.sound !== false) {
      getSfx().reload();
    }
    if (me) prevReloadingRef.current = me.reloading;

    // 事件 → 弹道 / 攻击反馈 / 音效
    const fxOn = driver.fx !== false;
    for (const ev of snap.events) {
      const mine = ev.shooterId === driver.myId;
      if (ev.kind === 'shot' && ev.pos && scene) {
        // 匕首：挥砍动画 + 弧光，不产生弹道/枪口火光
        if (mine && me?.weapon === 'dagger') {
          meleeSwingRef.current = performance.now();
          if (driver.sound !== false) getSfx().shoot('dagger');
          if (fxOn) {
            spawnSparks(ev.pos, 0xdbe7ff, 5);
            const slash = new THREE.Mesh(
              new THREE.PlaneGeometry(1.1, 0.34),
              new THREE.MeshBasicMaterial({
                color: 0xcfe2ff,
                transparent: true,
                opacity: 0.65,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
              }),
            );
            slash.position.set(ev.pos.x, Math.max(0.05, ev.pos.y), ev.pos.z);
            if (cameraRef.current) slash.quaternion.copy(cameraRef.current.quaternion);
            scene.add(slash);
            slashRefs.current.push({ mesh: slash, born: performance.now() });
          }
          continue;
        }
        const shooter = snap.players.find((p) => p.id === ev.shooterId);
        if (shooter && !shooter.visible && shooter.id !== driver.myId) continue;
        const from = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z).clone();
        let start: THREE.Vector3;
        if (ev.shooterId === driver.myId) {
          // 弹道从枪口出发（成熟 FPS 的 tracer 视觉），命中点仍是服务端射线结果
          const muzzleLocal =
            (gunRef.current?.userData.muzzlePos as THREE.Vector3 | undefined) ??
            new THREE.Vector3(0.22, -0.14, -1.0);
          start = gunRef.current
            ? gunRef.current.localToWorld(muzzleLocal.clone())
            : new THREE.Vector3(localPosRef.current.x, localPosRef.current.y + EYE_Y, localPosRef.current.z);
          if (fxOn) muzzleBornRef.current = performance.now();
          if (driver.sound !== false) getSfx().shoot(me?.weapon ?? 'rifle');
          // 后坐：视角轻微上跳并同步给引擎（联机服务端同样记录）
          const wd = me ? WEAPON_DEFS[me.weapon] : WEAPON_DEFS.rifle;
          gunRecoilRef.current = 1;
          viewRef.current.pitch = Math.min(
            BALANCE.arena.pitchClamp,
            viewRef.current.pitch + wd.recoil,
          );
          driverRef.current.send({
            type: 'look',
            yaw: viewRef.current.yaw,
            pitch: viewRef.current.pitch,
          });
        } else if (shooter && shooter.visible) {
          start = new THREE.Vector3(shooter.pos.x, shooter.pos.y + EYE_Y, shooter.pos.z);
        } else {
          continue;
        }
        if (fxOn) {
          const geo = new THREE.BufferGeometry().setFromPoints([start, from]);
          const line = new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 }),
          );
          line.frustumCulled = false;
          scene.add(line);
          tracerRef.current.push({ line, born: performance.now() });
          if (ev.shooterId === driver.myId) spawnSparks(ev.pos, 0xffd27a, 6);
        }
      }
      if (ev.kind === 'blocked') {
        if (ev.pos && fxOn) spawnSparks(ev.pos, 0x4da3ff, 7);
        if ((ev.shooterId === driver.myId || ev.targetId === driver.myId) && driver.sound !== false) {
          getSfx().shieldBlock();
        }
      }
      if (ev.kind === 'hit') {
        if (ev.targetId === driver.myId) {
          setHitAt(performance.now());
          setHitFlash({
            amount: ev.amount ?? 0,
            kind: 'taken',
            headshot: ev.text === '爆头！',
            at: performance.now(),
          });
          if (driver.sound !== false) getSfx().hurt();
        }
        if (mine) {
          if (driver.sound !== false) getSfx().hit(ev.text === '爆头！');
          setHitFlash({
            amount: ev.amount ?? 0,
            kind: 'dealt',
            headshot: ev.text === '爆头！',
            at: performance.now(),
          });
          if (ev.pos && fxOn) spawnSparks(ev.pos, 0xff7050, 8);
        }
      }
      if (ev.kind === 'kill' && ev.text) {
        setKillFeed((f) => [...f.slice(-5), ev.text]);
        if (mine) {
          if (driver.sound !== false) getSfx().kill();
          const target = snap.players.find((p) => p.id === ev.targetId);
          setKillFlash({ text: `击杀 ${target?.name ?? '敌人'}`, at: performance.now() });
        } else if (ev.targetId === driver.myId && driver.sound !== false) {
          getSfx().hurt();
        }
      }
      if (mine && ev.kind === 'skill' && driver.sound !== false) {
        getSfx().skill(me?.hero ?? null);
      }
      if (mine && ev.kind === 'ult' && driver.sound !== false) {
        getSfx().ult(me?.hero ?? null);
      }
      if (ev.kind === 'heal' && ev.targetId === driver.myId && driver.sound !== false) {
        getSfx().heal();
      }
      if (ev.kind === 'respawn' && ev.shooterId === driver.myId && driver.sound !== false) {
        getSfx().respawn();
      }
    }
  }, [driver.snapshot, driver.myId, buildWorld, driver.sound, getSfx, spawnSparks]);

  // ---- 调试碰撞盒 ----
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const removeGroup = () => {
      if (colliderGroupRef.current) {
        scene.remove(colliderGroupRef.current);
        disposeObject(colliderGroupRef.current);
        colliderGroupRef.current = null;
        playerCollidersRef.current.clear();
        colliderShapeRef.current = '';
      }
    };
    if (!showColliders) {
      removeGroup();
      return;
    }
    const snap = driver.snapshot;
    if (!snap) return;
    const arena = snap.arena ?? arenaRef.current;
    if (!arena) return;
    const r = BALANCE.arena.playerRadius;
    const bottom = BALANCE.arena.capsuleBottomY;
    const top = BALANCE.arena.capsuleTopY;
    const shapeKey = `${r}|${bottom}|${top}|${arena.obstacles.length}`;
    if (!colliderGroupRef.current || colliderShapeRef.current !== shapeKey || playerCollidersRef.current.size !== snap.players.length) {
      removeGroup();
      const group = new THREE.Group();
      group.name = 'debug-colliders';
      // 掩体碰撞盒（绿色线框，与引擎 AABB 完全一致）
      for (const b of arena.obstacles) {
        const geo = new THREE.BoxGeometry(b.maxX - b.minX, b.height, b.maxZ - b.minZ);
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.7 }),
        );
        line.position.set((b.minX + b.maxX) / 2, b.height / 2, (b.minZ + b.maxZ) / 2);
        group.add(line);
      }
      const myTeam = snap.players.find((p) => p.id === driver.myId)?.team;
      for (const p of snap.players) {
        const color =
          p.id === driver.myId
            ? 0x00e5ff
            : snap.mode === 'tdm'
              ? p.team === myTeam
                ? 0x39ff88
                : 0xff5060
              : 0xff5060;
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, top - bottom, 18, 1, true),
          new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
          }),
        );
        cyl.position.set(p.pos.x, bottom + (top - bottom) / 2, p.pos.z);
        group.add(cyl);
        playerCollidersRef.current.set(p.id, cyl);
      }
      scene.add(group);
      colliderGroupRef.current = group;
      colliderShapeRef.current = shapeKey;
      return;
    }
    const myTeam = snap.players.find((p) => p.id === driver.myId)?.team;
    for (const p of snap.players) {
      const cyl = playerCollidersRef.current.get(p.id);
      if (!cyl) continue;
      cyl.position.set(p.pos.x, bottom + (top - bottom) / 2, p.pos.z);
      const color =
        p.id === driver.myId
          ? 0x00e5ff
          : snap.mode === 'tdm'
            ? p.team === myTeam
              ? 0x39ff88
              : 0xff5060
            : 0xff5060;
      (cyl.material as THREE.MeshBasicMaterial).color.set(color);
    }
  }, [driver.snapshot, showColliders, driver.myId]);

  // ---- 输入 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const send = (input: RealtimeInputAction) => driverRef.current.send(input);
    const syncMove = () => {
      const k = keysRef.current;
      const mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
      const mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
      const dir = viewRelativeMove(viewRef.current.yaw, mx, mz);
      const last = lastMoveRef.current;
      if (Math.abs(dir.x - last.x) > 1e-4 || Math.abs(dir.z - last.z) > 1e-4) {
        // 视角转动时会高频触发：move 以 60Hz 上限发送，避免触发服务端洪泛保护
        const now = performance.now();
        if (now - lastMoveSentRef.current < 16) return;
        lastMoveSentRef.current = now;
        lastMoveRef.current = { x: dir.x, z: dir.z };
        send({ type: 'move', x: dir.x, z: dir.z });
      }
    };

    /** 当前是否处于二段技能瞄准（服务器快照 + 本地未确认的 pending） */
    const armedKind = (): 'skill' | 'ult' | null => {
      const m = snapRef.current?.players.find((p) => p.id === driverRef.current.myId);
      if (m?.skillAim || pendingAimRef.current === 'skill') return 'skill';
      if (m?.ultAim || pendingAimRef.current === 'ult') return 'ult';
      return null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowScore(true);
        return;
      }
      if (e.repeat) return;
      keysRef.current[e.code] = true;
      switch (e.code) {
        case 'KeyW':
        case 'KeyA':
        case 'KeyS':
        case 'KeyD':
          syncMove();
          break;
        case 'Space':
          send({ type: 'jump', pressed: true });
          if (driverRef.current.sound !== false) getSfx().jump();
          break;
        case 'KeyR':
          send({ type: 'reload' });
          break;
        case 'Digit1':
          send({ type: 'switchWeapon', weapon: 'rifle' });
          if (driverRef.current.sound !== false) getSfx().switchWeapon();
          break;
        case 'Digit2':
          send({ type: 'switchWeapon', weapon: 'sniper' });
          if (driverRef.current.sound !== false) getSfx().switchWeapon();
          break;
        case 'Digit3':
          send({ type: 'switchWeapon', weapon: 'pistol' });
          if (driverRef.current.sound !== false) getSfx().switchWeapon();
          break;
        case 'Digit4':
          send({ type: 'switchWeapon', weapon: 'dagger' });
          if (driverRef.current.sound !== false) getSfx().switchWeapon();
          break;
        case 'KeyQ': {
          // 二段瞄准：Q 按下进入准备，再次按 Q 取消
          if (armedKind() === 'skill') {
            pendingAimRef.current = null;
            send({ type: 'skillCancel' });
          } else {
            pendingAimRef.current = 'skill';
            send({ type: 'skill' });
          }
          break;
        }
        case 'KeyE': {
          if (armedKind() === 'ult') {
            pendingAimRef.current = null;
            send({ type: 'ultCancel' });
          } else {
            pendingAimRef.current = 'ult';
            send({ type: 'ult' });
          }
          break;
        }
        case 'Escape': {
          const armed = armedKind();
          if (armed === 'skill') {
            pendingAimRef.current = null;
            send({ type: 'skillCancel' });
          } else if (armed === 'ult') {
            pendingAimRef.current = null;
            send({ type: 'ultCancel' });
          }
          break;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setShowScore(false);
        return;
      }
      keysRef.current[e.code] = false;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) syncMove();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      const v = viewRef.current;
      v.yaw -= e.movementX * BALANCE.client.mouseSensitivity;
      v.pitch -= e.movementY * BALANCE.client.mouseSensitivity;
      v.pitch = Math.max(-BALANCE.arena.pitchClamp, Math.min(BALANCE.arena.pitchClamp, v.pitch));
      // look 同样按 60Hz 上限发送；本地渲染始终使用即时视角
      const now = performance.now();
      if (now - lastLookSentRef.current >= 16) {
        lastLookSentRef.current = now;
        send({ type: 'look', yaw: v.yaw, pitch: v.pitch });
      }
      // 按住方向键转身时，立即按新视角重算移动向量（服务器以世界系执行）
      syncMove();
    };
    const onMouseDown = (e: MouseEvent) => {
      const lockHeld = document.pointerLockElement === canvas;
      const armed = armedKind();
      if (e.button === 0) {
        // 二段瞄准中：左键=向当前视角方向确认释放技能，而不是开枪。
        // 未锁鼠标时点击画布也应能确认（随后 onClick 立即请求锁定）。
        if (armed === 'skill') {
          pendingAimRef.current = null;
          send({ type: 'skillFire' });
        } else if (armed === 'ult') {
          pendingAimRef.current = null;
          send({ type: 'ultFire' });
        } else if (lockHeld) {
          send({ type: 'fire', pressed: true });
        }
      }
      if (e.button === 2) {
        // 二段瞄准中：右键=取消；否则保持开镜
        if (armed === 'skill') send({ type: 'skillCancel' });
        else if (armed === 'ult') send({ type: 'ultCancel' });
        else if (lockHeld) send({ type: 'ads', pressed: true });
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0 && armedKind() === null) send({ type: 'fire', pressed: false });
      if (e.button === 2 && armedKind() === null) send({ type: 'ads', pressed: false });
    };
    const onLockChange = () => setLocked(document.pointerLockElement === canvas);
    const onContext = (e: Event) => e.preventDefault();
    const onClick = () => {
      getSfx().unlock();
      const snap = snapRef.current;
      if (snap?.phase === 'playing') canvas.requestPointerLock();
    };
    // 鼠标滚轮切换武器：向上=前一把，向下=后一把
    const onWheel = (e: WheelEvent) => {
      if (document.pointerLockElement !== canvas) return;
      e.preventDefault();
      const snap = snapRef.current;
      const me = snap?.players.find((p) => p.id === driverRef.current.myId);
      const cur = me?.weapon ?? 'rifle';
      const idx = WEAPON_IDS.indexOf(cur);
      const next = WEAPON_IDS[(idx + (e.deltaY > 0 ? 1 : -1) + WEAPON_IDS.length) % WEAPON_IDS.length];
      send({ type: 'switchWeapon', weapon: next });
      if (driverRef.current.sound !== false) getSfx().switchWeapon();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onLockChange);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('click', onClick);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      // 释放输入，避免离开后服务器还认为在开火
      send({ type: 'fire', pressed: false });
      send({ type: 'ads', pressed: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 非对局阶段自动释放鼠标锁定，保证遮罩按钮可点
  useEffect(() => {
    if (driver.snapshot?.phase !== 'playing' && document.pointerLockElement === canvasRef.current) {
      document.exitPointerLock();
    }
  }, [driver.snapshot?.phase]);

  const snap = driver.snapshot;
  const me = snap?.players.find((p) => p.id === driver.myId) ?? null;
  const winnerName = snap?.winnerId ? snap.players.find((p) => p.id === snap.winnerId)?.name : null;

  return (
    <div className="ccf-root">
      <div className="ccf-canvas-host" ref={hostRef} />
      <button className="ccf-exit" onClick={driver.onExit} title="退出对局">
        ← 退出
      </button>
      {qualityNote && <div className="ccf-netstats" style={{ top: 80 }}>⚡ {qualityNote}</div>}
      {tuningEnabled && (
        <div className="ccf-netstats">
          🛰 ping {driver.stats?.pingMs ?? 0}ms · drift {driftM.toFixed(2)}m · pending{' '}
          {driver.stats?.pendingInputs ?? 0}
          {tuningEnabled ? ` · ${fps} fps` : ''}
          {driver.online ? '' : '（本地模式无网络）'}
        </div>
      )}
      {me && me.alive && snap?.phase === 'playing' && (
        <>
          <div
            ref={crosshairRef}
            className={`ccf-crosshair ${performance.now() - hitAt < 150 ? 'hit' : ''} ${
              me.skillAim || me.ultAim ? 'aiming' : ''
            }`}
          >
            <i className="c-top" />
            <i className="c-bottom" />
            <i className="c-left" />
            <i className="c-right" />
          </div>
          {(me.skillAim || me.ultAim) && (
            <div className="ccf-aim-banner">
              {me.skillAim ? '💣 左键投掷炸弹' : '⛈️ 左键释放雷暴云'}
              <span>右键 / Q / E 取消</span>
            </div>
          )}
          {me.ads && me.weapon === 'sniper' && <div className="ccf-scope" />}
          {driver.fx !== false && (
            <>
              <div className={`ccf-damage-vignette ${performance.now() - hitAt < 180 ? 'on' : ''}`} />
              {me.hp / me.maxHp < 0.5 && (
                <div className={`ccf-lowhp ${me.hp / me.maxHp < 0.3 ? 'danger' : 'warn'}`} />
              )}
              {me.stealthT > 0 && <div className="ccf-stealth" />}
              {me.invulnT > 0 && <div className="ccf-invuln" />}
              {killFlash && performance.now() - killFlash.at < 1200 && (
                <div className="ccf-killflash">{killFlash.text}</div>
              )}
            </>
          )}
          {hitFlash && performance.now() - hitFlash.at < 600 && (
            <div className={`ccf-hitflash ${hitFlash.kind} ${hitFlash.headshot ? 'head' : ''}`}>
              {hitFlash.kind === 'taken' ? '-' : '+'}
              {hitFlash.amount}
              {hitFlash.headshot ? ' 爆头' : ''}
            </div>
          )}
          <Hud snap={snap} me={me} killFeed={killFeed} />
        </>
      )}
      {showScore && snap && <Scoreboard snap={snap} myId={driver.myId} />}

      {snap?.phase === 'heroSelect' && (
        <HeroSelect
          snap={snap}
          myId={driver.myId}
          onPick={(hero) => driver.send({ type: 'selectHero', hero })}
          onExit={driver.onExit}
        />
      )}
      {snap?.phase === 'playing' && me && !me.alive && (
        <div className="ccf-overlay">
          <div className="ccf-overlay-panel">
            <div className="ccf-title">💀 你阵亡了</div>
            <div className="ccf-big-num">{Math.max(0, Math.ceil(me.respawnIn))}</div>
            <p className="ccf-muted">等待复活期间可以更换英雄，复活后立即生效：</p>
            <div className="ccf-death-heroes">
              {HERO_LIST.map((h) => (
                <button
                  key={h.key}
                  className={`ccf-death-hero ${me.hero === h.key ? 'active' : ''}`}
                  onClick={() => driver.send({ type: 'selectHero', hero: h.key })}
                >
                  <span>{h.emoji}</span>
                  {h.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {snap?.phase === 'gameOver' && (
        <div className="ccf-overlay">
          <div className="ccf-overlay-panel">
            <div className="ccf-title">🏆 对局结束</div>
            <p className="ccf-muted">
              {snap.mode === 'tdm'
                ? `胜者：${snap.winnerTeam === 'A' ? '鳄龙队' : '炎龙队'}（${snap.teamScores.A}:${snap.teamScores.B}）`
                : `胜者：${winnerName ?? '—'}`}
            </p>
            <Scoreboard snap={snap} myId={driver.myId} />
            <div className="ccf-overlay-actions">
              {driver.onRestart && <button onClick={driver.onRestart}>🔁 再来一局</button>}
              <button onClick={driver.onExit}>← 退出</button>
            </div>
          </div>
        </div>
      )}
      {!locked && snap?.phase === 'playing' && me?.alive && (
        <button className="ccf-hint" onClick={() => canvasRef.current?.requestPointerLock()}>
          🖱️ 点击锁定鼠标开始操作（WASD 移动 / 左键射击 / 右键开镜 / 滚轮或 1-4 切枪 / R 换弹 / Q 技能 / E 终极技 / 按住 Tab 战绩）
        </button>
      )}
      {driver.error && <div className="ccf-hint" style={{ top: 10 }}>⚠️ {driver.error}</div>}
      {tuningEnabled && !driver.online && (
        <TuningPanel
          enabled
          showColliders={showColliders}
          onShowColliders={setShowColliders}
        />
      )}
    </div>
  );
}

function makeNameSprite(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 12), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.position.y = 2.45;
  return sprite;
}

function makeShieldWallMesh(): THREE.Mesh {
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x3d9bff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.85 }),
  );
  border.position.z = 0.01;
  wall.add(border);
  return wall;
}

function makeGun(weapon: WeaponId): THREE.Group {
  const g = new THREE.Group();
  const mat = (color: number, rough = 0.4) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.25 });
  const box = (
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    return m;
  };

  const muzzle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    }),
  );
  muzzle.position.set(0.22, -0.14, -1.15);
  muzzle.visible = false;

  if (weapon === 'rifle') {
    g.add(box(0.1, 0.14, 0.52, 0x2b3242, 0.22, -0.2, -0.42)); // 机匣
    g.add(box(0.05, 0.05, 0.3, 0x11151d, 0.22, -0.15, -0.78)); // 枪管
    g.add(box(0.06, 0.13, 0.16, 0x39445a, 0.22, -0.22, -0.2)); // 弹匣
    g.add(box(0.07, 0.09, 0.2, 0x1c2330, 0.22, -0.12, -0.12)); // 瞄具
    g.add(box(0.045, 0.06, 0.18, 0x7c4a2a, 0.22, -0.24, -0.36)); // 护木
  } else if (weapon === 'sniper') {
    g.add(box(0.09, 0.12, 0.66, 0x1d2533, 0.22, -0.2, -0.5)); // 枪身
    g.add(box(0.04, 0.04, 0.56, 0x0d1118, 0.22, -0.14, -1.0)); // 长枪管
    g.add(box(0.06, 0.06, 0.2, 0x0d1118, 0.22, -0.08, -0.28)); // 瞄镜
    g.add(box(0.05, 0.12, 0.14, 0x39445a, 0.22, -0.22, -0.12)); // 握把
  } else if (weapon === 'pistol') {
    g.add(box(0.07, 0.11, 0.2, 0x3a4252, 0.22, -0.2, -0.32)); // 套筒
    g.add(box(0.06, 0.13, 0.09, 0x252d3a, 0.22, -0.24, -0.2)); // 握把
    g.add(box(0.04, 0.04, 0.12, 0x11151d, 0.22, -0.16, -0.46)); // 枪管
  } else {
    g.add(box(0.03, 0.02, 0.28, 0xb9c4d6, 0.22, -0.18, -0.4)); // 刀刃
    g.add(box(0.05, 0.06, 0.12, 0x39445a, 0.22, -0.2, -0.24)); // 护手/握柄
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  if (GUN_GLB[weapon]) {
    muzzle.position.copy(GUN_GLB[weapon]!.muzzle);
    g.userData.muzzlePos = GUN_GLB[weapon]!.muzzle.clone();
    loadWeaponGltf(g, weapon, muzzle);
  } else {
    muzzle.position.copy(GUN_GLB.dagger!.muzzle);
    g.userData.muzzlePos = GUN_GLB.dagger!.muzzle.clone();
  }
  return g;
}

function makeEffectMesh(eff: SnapshotEffect): THREE.Object3D {
  if (eff.kind === 'bomb') {
    // 抛体炸弹：亮色弹体 + 半透明光晕，配合轨迹线形成可见抛物线
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb45a, transparent: true, opacity: 0.95 }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff8c2a,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(core, halo);
    return group;
  }
  if (eff.kind === 'ultRing') {
    // 炎刃大招范围火环：半径即判定范围，落地平面清晰可见
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, eff.radius * 0.78), eff.radius, 72),
      new THREE.MeshBasicMaterial({
        color: 0xff6a2a,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.08;
    return mesh;
  }
  if (eff.kind === 'explosion') {
    return new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffa040,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  }
  if (eff.kind === 'healWave') {
    // 灵音扇形治愈波：朝视角方向展开的扇形，视觉与判定同为“视角前方扇区”
    const mesh = new THREE.Mesh(
      makeFanGeometry(eff.radius, eff.yaw ?? 0, eff.arc ?? Math.PI / 3),
      new THREE.MeshBasicMaterial({
        color: 0x2fd06a,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.y = 0.08;
    return mesh;
  }
  const colors = {
    fireTrail: 0xff6a2a,
    healZone: 0x2fd06a,
    stormZone: 0x6fa2ff,
  } as const;
  const kind = eff.kind === 'fireTrail' || eff.kind === 'healZone' || eff.kind === 'stormZone' ? eff.kind : 'fireTrail';
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(eff.radius, 26),
    new THREE.MeshBasicMaterial({
      color: colors[kind],
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  return mesh;
}

/** 扇形地面几何（XZ 平面，开口朝向 yaw，半角 arc） */
function makeFanGeometry(radius: number, yaw: number, arc: number): THREE.BufferGeometry {
  const segments = 24;
  const positions: number[] = [0, 0, 0];
  for (let i = 0; i <= segments; i++) {
    const a = yaw - arc + (arc * 2 * i) / segments;
    positions.push(Math.sin(a) * radius, 0, Math.cos(a) * radius);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(0, i + 1, i + 2);
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

// ---------------- 手感调试面板（?debug=1，仅本地 vs AI） ----------------

function TuningPanel({
  enabled,
  showColliders,
  onShowColliders,
}: {
  enabled: boolean;
  showColliders: boolean;
  onShowColliders: (show: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const build = (container: HTMLElement): Promise<{ dispose: () => void }> => {
      return import('tweakpane').then(({ Pane }) => {
        // tweakpane v4 的声明文件引用了未随包发布的 @tweakpane/core 类型，
        // 这里用结构化类型包装，避免 skipLibCheck 下的错误推导。
        type TPane = {
          addFolder: (params: { title: string }) => TPane;
          addBinding: (obj: object, key: string, opt?: Record<string, unknown>) => unknown;
          addButton: (params: { title: string }) => { on: (event: 'click', cb: () => void) => unknown };
          dispose: () => void;
        };
        const pane = new Pane({ container, title: '🐊 手感调参（本地）' }) as unknown as TPane;
        const bind = (
          folder: TPane,
          obj: object,
          key: string,
          opt: Record<string, unknown>,
        ) => {
          folder.addBinding(obj, key, opt);
        };

        const mov = pane.addFolder({ title: '移动' });
        bind(mov, BALANCE.movement, 'gravity', { min: 0, max: 100, step: 0.5, label: '重力' });
        bind(mov, BALANCE.movement, 'jumpVelocity', { min: 0, max: 30, step: 0.2, label: '跳跃初速' });
        bind(mov, BALANCE.movement, 'adsSpeedMult', { min: 0, max: 1, step: 0.05, label: '开镜移速倍率' });

        const hit = pane.addFolder({ title: '碰撞/命中盒（实时）' });
        const colliderFlags = { show: showColliders };
        const showBinding = hit.addBinding(colliderFlags, 'show', { label: '显示玩家碰撞盒' }) as unknown as {
          on: (event: 'change', cb: (ev: { value: boolean }) => void) => unknown;
        };
        showBinding.on('change', (ev) => onShowColliders(ev.value));
        bind(hit, BALANCE.arena, 'playerRadius', { min: 0.1, max: 1.5, step: 0.05, label: '玩家半径' });
        bind(hit, BALANCE.arena, 'capsuleBottomY', { min: 0, max: 2, step: 0.05, label: '胶囊底高' });
        bind(hit, BALANCE.arena, 'capsuleTopY', { min: 0.5, max: 4, step: 0.05, label: '胶囊顶高' });
        bind(hit, BALANCE.arena, 'eyeY', { min: 0.5, max: 4, step: 0.05, label: '眼高' });
        bind(hit, BALANCE.arena, 'headshotMinY', { min: 0.5, max: 4, step: 0.05, label: '爆头线高度' });

        const heroFolder = pane.addFolder({ title: '英雄' });
        for (const id of HERO_IDS) {
          const h = BALANCE.heroes[id];
          const f = heroFolder.addFolder({ title: `${h.emoji} ${h.name}` });
          bind(f, h, 'hp', { min: 50, max: 500, step: 5, label: '生命' });
          bind(f, h, 'speed', { min: 1, max: 15, step: 0.1, label: '移速' });
          bind(f, h, 'skillCd', { min: 0, max: 60, step: 0.5, label: '技能CD(秒)' });
        }

        const wpn = pane.addFolder({ title: '武器' });
        for (const id of WEAPON_IDS) {
          const w = BALANCE.weapons[id];
          const f = wpn.addFolder({ title: `${w.emoji} ${w.name}` });
          bind(f, w, 'damage', { min: 0, max: 300, step: 1, label: '伤害' });
          bind(f, w, 'interval', { min: 20, max: 3000, step: 10, label: '射击间隔(ms)' });
          bind(f, w, 'spread', { min: 0, max: 0.2, step: 0.001, label: '腰射散布' });
          bind(f, w, 'adsSpread', { min: 0, max: 0.05, step: 0.0005, label: '开镜散布' });
          bind(f, w, 'headshot', { min: 0.5, max: 5, step: 0.1, label: '爆头倍率' });
          bind(f, w, 'reloadMs', { min: 0, max: 5000, step: 50, label: '换弹(ms)' });
          bind(f, w, 'recoil', { min: 0, max: 0.1, step: 0.001, label: '后坐上跳' });
          bind(f, w, 'bloomPerShot', { min: 0, max: 0.03, step: 0.0005, label: '散布膨胀/发' });
          bind(f, w, 'bloomMax', { min: 0, max: 0.1, step: 0.001, label: '散布上限' });
          bind(f, w, 'bloomRecoveryPerSec', { min: 0, max: 1, step: 0.01, label: '散布恢复/秒' });
        }

        const skill = pane.addFolder({ title: '技能与终极技' });
        bind(skill, BALANCE.heroes.yanren.ability, 'dashDistance', { min: 1, max: 30, step: 0.5, label: '炎刃冲刺距离' });
        bind(skill, BALANCE.heroes.yanren.ability, 'trailDps', { min: 0, max: 100, step: 1, label: '火焰路径DPS' });
        bind(skill, BALANCE.heroes.yanren.ability, 'ultRadius', { min: 1, max: 30, step: 0.5, label: '炎刃大招半径' });
        bind(skill, BALANCE.heroes.yingxiao.ability, 'stealthDuration', { min: 0.5, max: 15, step: 0.5, label: '影枭隐身(秒)' });
        bind(skill, BALANCE.heroes.tiebi.ability, 'shieldValue', { min: 0, max: 1000, step: 10, label: '铁壁护盾生命' });
        bind(skill, BALANCE.heroes.tiebi.ability, 'shieldDuration', { min: 0.5, max: 30, step: 0.5, label: '铁壁护盾持续(秒)' });
        bind(skill, BALANCE.heroes.tiebi.ability, 'shieldWidth', { min: 0.5, max: 20, step: 0.1, label: '铁壁护盾宽度' });
        bind(skill, BALANCE.heroes.tiebi.ability, 'shieldHeight', { min: 0.5, max: 8, step: 0.1, label: '铁壁护盾高度' });
        bind(skill, BALANCE.heroes.tiebi.ability, 'shieldDistance', { min: 0.2, max: 6, step: 0.1, label: '铁壁护盾距离' });
        bind(skill, BALANCE.heroes.lingyin.ability, 'selfHeal', { min: 0, max: 300, step: 5, label: '灵音自疗' });
        bind(skill, BALANCE.heroes.lingyin.ability, 'waveRange', { min: 1, max: 40, step: 1, label: '治愈波距离' });
        bind(skill, BALANCE.heroes.lingyin.ability, 'waveAngleDeg', { min: 5, max: 180, step: 5, label: '治愈波扇角(度)' });
        bind(skill, BALANCE.heroes.guilei.ability, 'bombDamage', { min: 0, max: 200, step: 1, label: '诡雷炸弹伤害' });
        bind(skill, BALANCE.heroes.guilei.ability, 'bombRadius', { min: 0.5, max: 20, step: 0.5, label: '诡雷爆炸半径' });
        bind(skill, BALANCE.heroes.guilei.ability, 'stormDps', { min: 0, max: 100, step: 1, label: '雷暴DPS' });

        const combat = pane.addFolder({ title: '战斗' });
        bind(combat, BALANCE.combat, 'respawnMs', { min: 0, max: 10000, step: 100, label: '重生(ms)' });
        bind(combat, BALANCE.combat, 'ultPerSecond', { min: 0, max: 20, step: 0.5, label: '终极充能/秒' });
        bind(combat, BALANCE.combat, 'ultPerKill', { min: 0, max: 100, step: 1, label: '击杀充能' });
        bind(combat, BALANCE.combat, 'explosionFalloff', { min: 0, max: 1, step: 0.05, label: '爆炸距离衰减' });

        const client = pane.addFolder({ title: '客户端手感' });
        bind(client, BALANCE.client, 'mouseSensitivity', { min: 0.0005, max: 0.02, step: 0.0002, label: '鼠标灵敏度' });
        bind(client, BALANCE.client, 'correctionRate', { min: 0, max: 60, step: 0.5, label: '服务端校正速率' });
        bind(client, BALANCE.client, 'interpolationRate', { min: 0, max: 60, step: 0.5, label: '他人插值速率' });
        bind(client, BALANCE.client, 'interpolationBufferMs', { min: 0, max: 200, step: 5, label: '联机插值缓冲(ms)' });

        pane.addButton({ title: '⬇️ 导出 gameplay.tuned.json' }).on('click', () => {
          const blob = new Blob([balanceToJson()], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'gameplay.tuned.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        });
        pane.addButton({ title: '♻️ 恢复出厂配置' }).on('click', () => {
          resetBalance();
          pane.dispose();
          void build(container);
        });
        return pane;
      });
    };

    const host = hostRef.current;
    if (!host) return;
    let pane: { dispose: () => void } | null = null;
    void build(host).then((p) => {
      if (disposed) p.dispose();
      else pane = p;
    });
    return () => {
      disposed = true;
      pane?.dispose();
    };
  }, [enabled]);

  if (!enabled) return null;
  return <div className="ccf-tuning-host" ref={hostRef} />;
}

// ---------------- HUD / 计分板 / 英雄选择 ----------------

function Hud({ snap, me, killFeed }: { snap: Snapshot; me: SnapshotPlayer; killFeed: string[] }) {
  const hero = me.hero ? HERO_DEFS[me.hero] : null;
  const wd = WEAPON_DEFS[me.weapon];
  const hpPct = Math.max(0, Math.min(100, (me.hp / me.maxHp) * 100));
  const shieldMax =
    me.hero === 'tiebi'
      ? BALANCE.heroes.tiebi.ability.shieldValue ?? 300
      : 80;
  const shieldPct = Math.max(0, Math.min(100, (me.shield / shieldMax) * 100));
  const ads = me.ads;
  return (
    <div className="ccf-hud">
      <div className="ccf-hud-top">
        <div className="ccf-chips">
          {snap.mode === 'training' ? (
            <>
              <span className="ccf-chip">
                🎯 命中率 {(me.shots ?? 0) > 0 ? Math.round(((me.hits ?? 0) / (me.shots ?? 1)) * 100) : 0}%
              </span>
              <span className="ccf-chip">
                ✅ 命中 {me.hits ?? 0}/{me.shots ?? 0} 发
              </span>
              <span className="ccf-chip">
                💥 爆头率 {(me.hits ?? 0) > 0 ? Math.round(((me.headshots ?? 0) / (me.hits ?? 1)) * 100) : 0}%
              </span>
              <span className="ccf-chip">📊 伤害 {me.damageDealt ?? 0} · 击碎 {me.kills}</span>
            </>
          ) : (
            <>
              <span className="ccf-chip">🎯 {snap.mode === 'tdm' ? `团队死斗 ${snap.teamScores.A}:${snap.teamScores.B}/${snap.scoreLimit}` : `自由混战 ${me.kills}/${snap.scoreLimit}`}</span>
              <span className="ccf-chip">⏱ {Math.max(0, Math.ceil(snap.timeLeft / 1000))}s</span>
              <span className="ccf-chip">🏆 {me.score} 分 · {me.kills} 杀 {me.deaths} 死</span>
              {me.stealthT > 0 && <span className="ccf-chip ccf-stealth-chip">🦉 隐身 {me.stealthT.toFixed(1)}s</span>}
              {me.invulnT > 0 && <span className="ccf-chip ccf-invuln-chip">✨ 无敌 {me.invulnT.toFixed(1)}s</span>}
            </>
          )}
        </div>
        {hero && (
          <span className="ccf-chip">
            {hero.emoji} {hero.name} · {hero.role} · {wd.emoji} {wd.name}
          </span>
        )}
      </div>
      <div className="ccf-killfeed">
        {killFeed.map((t, i) => (
          <div key={`${t}-${i}`} className="ccf-kill-item">{t}</div>
        ))}
      </div>

      <div className="ccf-hud-bottom-left">
        <div className="ccf-hp-row">
          <span className="ccf-hp-label">❤️ {Math.ceil(me.hp)}</span>
          <div className="ccf-hp-bar"><div className="ccf-hp-fill" style={{ width: `${hpPct}%` }} /></div>
        </div>
        <div className="ccf-hp-row">
          <span className="ccf-hp-label">{me.hero === 'tiebi' ? '🧱' : '🛡️'} {Math.ceil(me.shield)}</span>
          <div className="ccf-shield-bar"><div className="ccf-shield-fill" style={{ width: `${shieldPct}%` }} /></div>
        </div>
        <div className="ccf-ammo">
          <span className="ccf-ammo-cur">{me.reloading ? '…' : me.ammo}</span>
          <span className="ccf-ammo-sep">/</span>
          <span className="ccf-ammo-res">{wd.reserve === Infinity ? '∞' : me.reserve}</span>
          <span className="ccf-ammo-meta">
            {me.reloading ? `换弹中 ${(me.reloadT / 1000).toFixed(1)}s` : ads ? '🔍 开镜' : wd.name}
          </span>
        </div>
      </div>

      <div className="ccf-hud-bottom-right">
        <div className={`ccf-skill ccf-skill-box ${me.skillAim ? 'aiming' : me.skillCd <= 0 ? 'ready' : ''}`}>
          <span className="ccf-skill-key">Q</span>
          <span className="ccf-skill-name">
            {me.skillAim
              ? hero?.key === 'guilei'
                ? '左键投掷 · 右键取消'
                : hero?.skillName ?? '技能'
              : hero?.skillName ?? '技能'}
          </span>
          {me.skillAim && <span className="ccf-aiming-dot" />}
          {!me.skillAim && me.skillCd > 0 && <span className="ccf-cd">{me.skillCd.toFixed(1)}</span>}
        </div>
        <div className={`ccf-skill ccf-skill-box ${me.ultAim ? 'aiming' : me.ultCharge >= 100 ? 'ready' : ''}`}>
          <span className="ccf-skill-key">E</span>
          <span className={`ccf-skill-name ${me.ultCharge >= 100 ? 'ccf-ult-ready' : ''}`}>
            {me.ultAim
              ? '左键释放 · 右键取消'
              : `${hero ? hero.ultName : '终极技'} · ${Math.floor(me.ultCharge)}%`}
          </span>
          {me.ultAim && <span className="ccf-aiming-dot" />}
          {!me.ultAim && me.ultCharge < 100 && (
            <div className="ccf-shield-bar" style={{ width: 90, flex: 'none' }}>
              <div className="ccf-ult-ready" style={{ width: `${me.ultCharge}%`, height: '100%', background: '#ffd166' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Scoreboard({ snap, myId }: { snap: Snapshot; myId: string | null }) {
  const rows = [...snap.players]
    .filter((p) => p.visible || p.id === myId)
    .sort((a, b) => b.score - a.score || b.kills - a.kills);
  return (
    <div className="ccf-scoreboard">
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>英雄</th>
            <th>击杀</th>
            <th>死亡</th>
            <th>积分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.id === myId ? 'me-row' : ''}>
              <td>{p.name}{p.isBot ? ' 🤖' : ''}{p.id === myId ? '（你）' : ''}</td>
              <td>{p.hero ? HERO_DEFS[p.hero].emoji : '—'}</td>
              <td>{p.kills}</td>
              <td>{p.deaths}</td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeroSelect({
  snap,
  myId,
  onPick,
  onExit,
}: {
  snap: Snapshot;
  myId: string | null;
  onPick: (hero: HeroId) => void;
  onExit: () => void;
}) {
  const me = snap.players.find((p) => p.id === myId);
  return (
    <div className="ccf-overlay">
      <div className="ccf-overlay-panel">
        <div className="ccf-title">🐊 选择你的英雄</div>
        <p className="ccf-muted">
          {me?.hero ? '可重新选择；全部玩家就绪后开战' : `剩余 ${Math.max(0, Math.ceil(snap.heroSelectLeft / 1000))} 秒自动分配`}
        </p>
        <div className="ccf-hero-grid">
          {HERO_LIST.map((h) => (
            <button
              key={h.key}
              className={`ccf-hero-card ${me?.hero === h.key ? 'ccf-ult-ready' : ''}`}
              onClick={() => onPick(h.key)}
            >
              <div className="ccf-hero-emoji">{h.emoji}</div>
              <div className="ccf-hero-name">{h.name}</div>
              <div className="ccf-hero-role">{h.role} · {h.hp} 生命</div>
              <div className="ccf-hero-desc">
                <b>Q {h.skillName}</b>：{h.skillDesc}
                <br />
                <b>E {h.ultName}</b>：{h.ultDesc}
              </div>
            </button>
          ))}
        </div>
        <p className="ccf-muted">已选：{snap.players.filter((p) => p.hero).map((p) => `${p.name}→${p.hero ? HERO_DEFS[p.hero].name : ''}`).join(' · ') || '暂无'}</p>
        <div className="ccf-overlay-actions">
          <button onClick={onExit}>← 退出</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 本地 vs AI ----------------

export function CorcodragonFightLocalScreen({
  playerCount,
  myName,
  config,
  sound,
  fx,
  onExit,
}: {
  playerCount: number;
  myName: string;
  config: FightConfig;
  sound: boolean;
  fx: boolean;
  onExit: () => void;
}) {
  const [round, setRound] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const engineRef = useRef<CorcodragonFightEngine | null>(null);

  useEffect(() => {
    const training = config.mode === 'training';
    const players = training
      ? [{ id: 'you', name: myName || '你', isBot: false }]
      : [
          { id: 'you', name: myName || '你', isBot: false },
          ...Array.from({ length: Math.max(1, playerCount - 1) }, (_, i) => ({
            id: `bot${i + 1}`,
            name: ['阿呆', '梅林', '小圆', '老巴', '铁柱', '花卷'][i % 6],
            isBot: true,
          })),
        ];
    const engine = new CorcodragonFightEngine(players, {
      mode: config.mode,
      scoreLimit: config.scoreLimit,
      tickStepMs: 1000 / (config.tickHz ?? 30),
      respawnMs: config.respawnMs ?? 15_000,
      aiStyle: config.aiStyle ?? 'combat',
      aiLevel: config.aiLevel ?? 'normal',
      trainingTargets: training ? TRAINING_TARGETS.map((t) => ({ ...t })) : undefined,
      matchTimeMs: config.mode === 'ffa' ? 10 * 60_000 : 8 * 60_000,
    });
    engineRef.current = engine;
    let raf = 0;
    let last = performance.now();
    let lastSnap = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(BALANCE.client.maxDeltaMs, Math.max(0, now - last));
      last = now;
      engine.tick(dt);
      if (now - lastSnap >= 45) {
        lastSnap = now;
        setSnapshot(engine.getSnapshot('you'));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      engineRef.current = null;
    };
  }, [round, playerCount, myName, config.mode, config.scoreLimit, config.aiStyle, config.aiLevel]);

  const send = useCallback((input: RealtimeInputAction) => {
    engineRef.current?.applyInput('you', input);
  }, []);

  return (
    <FpsGameView
      driver={{
        snapshot,
        myId: 'you',
        online: false,
        error: null,
        sound,
        fx,
        send,
        onExit,
        onRestart: () => setRound((r) => r + 1),
      }}
    />
  );
}

// ---------------- 详情/配置页 ----------------

export function CorcodragonFightDetailScreen({
  coverUrl,
  playerCount,
  onPlayerCountChange,
  prefs,
  onToggleSound,
  onToggleFx,
  onPlayLocal,
  onPlayOnline,
  onlineReady = false,
  onBack,
}: {
  coverUrl: string;
  playerCount: number;
  onPlayerCountChange: (n: number) => void;
  prefs: FightPrefs;
  onToggleSound: () => void;
  onToggleFx: () => void;
  onPlayLocal: (config: FightConfig) => void;
  onPlayOnline: (config: FightConfig) => void;
  onlineReady?: boolean;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<GameModeKind>('ffa');
  const [scoreLimit, setScoreLimit] = useState(15);
  const [tickHz, setTickHz] = useState(30);
  const [respawnMs, setRespawnMs] = useState(15_000);
  const [aiStyle, setAiStyle] = useState<AIStyle>('combat');
  const [aiLevel, setAiLevel] = useState<AILevel>('normal');
  const config = { mode, scoreLimit, tickHz, respawnMs, aiStyle, aiLevel };
  return (
    <div className="page detail-page game-foyer game-foyer--fight">
      <div className="panel detail-panel ccf-detail-panel">
        <button className="ghost-btn foyer-back" onClick={onBack}>← 返回游戏大厅</button>
        <div className="foyer-hero">
        <div className="foyer-intro">
        <div className="detail-head">
          <div className="detail-title">
            <h1>鳄龙咆哮</h1>
            <span className="detail-meta">2–7 人 · 英雄射击 · 自由混战 / 团队死斗</span>
          </div>
        </div>
        <p className="detail-desc">
          第一人称 3D 英雄射击：5 位鳄龙英雄（冲刺/隐身/护盾/治疗/炸弹）× 4 种武器，
          每一发都有清晰的命中与爆头反馈，先到击杀线者获胜。建议使用桌面浏览器 + 鼠标键盘。
        </p>
        <div className="foyer-facts"><span><b>5</b> 位英雄</span><span><b>4</b> 种武器</span><span><b>3</b> 种模式</span></div>
        </div>
        <div className="foyer-art"><img src={coverUrl} alt="鳄龙英雄小队" /></div>
        </div>

        <div className="detail-modes">
          <section className="detail-mode foyer-config">
            <h2>对战设置</h2>
            <div className="field">
              <span>模式</span>
              <div className="ccf-mode-row">
                <button className={`ccf-mode-btn ${mode === 'ffa' ? 'active' : ''}`} onClick={() => setMode('ffa')}>
                  🆚 自由混战
                </button>
                <button className={`ccf-mode-btn ${mode === 'tdm' ? 'active' : ''}`} onClick={() => setMode('tdm')}>
                  🤝 团队死斗
                </button>
                <button className={`ccf-mode-btn ${mode === 'training' ? 'active' : ''}`} onClick={() => setMode('training')}>
                  🎯 训练场
                </button>
              </div>
            </div>
            <div className="field">
              <span>击杀线</span>
              <select className="bot-select" value={scoreLimit} onChange={(e) => setScoreLimit(Number(e.target.value))}>
                {[10, 15, 25].map((n) => (
                  <option key={n} value={n}>{n} 杀</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>服务端同步频率</span>
              <select
                className="bot-select"
                value={tickHz}
                onChange={(e) => setTickHz(Number(e.target.value))}
              >
                <option value={20}>20Hz（省资源）</option>
                <option value={30}>30Hz（推荐）</option>
                <option value={60}>60Hz（最顺滑）</option>
              </select>
            </div>
            <div className="field">
              <span>复活等待</span>
              <select
                className="bot-select"
                value={respawnMs}
                onChange={(e) => setRespawnMs(Number(e.target.value))}
              >
                {[3, 5, 10, 15, 20].map((s) => (
                  <option key={s} value={s * 1000}>{s} 秒</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>AI 行为</span>
              <select className="bot-select" value={aiStyle} onChange={(e) => setAiStyle(e.target.value as AIStyle)}>
                <option value="combat">⚔️ 实战 AI（会索敌和进攻）</option>
                <option value="movement">🧪 陪练（只走位不攻击）</option>
              </select>
            </div>
            <div className="field">
              <span>AI 难度</span>
              <select className="bot-select" value={aiLevel} onChange={(e) => setAiLevel(e.target.value as AILevel)}>
                <option value="easy">🐣 简单（低命中率/慢反应）</option>
                <option value="normal">⚖️ 普通（中等命中率）</option>
                <option value="hard">🔥 困难（高命中率/快反应）</option>
              </select>
            </div>
          </section>

          <section className="detail-mode foyer-local">
            <h2>本地对局</h2>
            {mode === 'training' ? (
              <p className="muted">
                训练场：固定圆靶 / 移动圆靶 / 固定人靶 / 移动人靶，实时统计命中率与爆头率。
              </p>
            ) : (
              <div className="field">
                <span>玩家总数（其余为 AI）</span>
                <div className="count-picker">
                  {Array.from({ length: 6 }, (_, i) => i + 2).map((n) => (
                    <button key={n} className={n === playerCount ? 'count-btn active' : 'count-btn'} onClick={() => onPlayerCountChange(n)}>
                      {n} 人
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button className="primary-btn big" onClick={() => onPlayLocal(config)}>
              {mode === 'training' ? '🎯 进入训练场' : '🎮 开始（本地 vs AI）'}
            </button>
          </section>

          <section className="detail-mode foyer-online">
            <h2>好友对战</h2>
            <p className="muted">
              创建房间分享房间码，2-7 人同房实时对战，支持 AI 补位。
            </p>
            <button
              className="primary-btn big"
              disabled={!onlineReady || mode === 'training'}
              onClick={() => onPlayOnline(config)}
              title={mode === 'training' ? '训练场仅本地可用' : ''}
            >
              {mode === 'training'
                ? '🎯 训练场仅本地可用'
                : onlineReady
                  ? '🌐 进入联机大厅'
                  : '🔧 联机通道接入中……'}
            </button>
          </section>

          <section className="detail-mode foyer-preferences">
            <h2>游戏偏好</h2>
            <div className="pref-row">
              <button
                className={`pref-btn ${prefs.sound ? 'active' : ''}`}
                onClick={onToggleSound}
                title="程序化枪声/技能/击杀音效"
              >
                {prefs.sound ? '🔊 音效开' : '🔇 音效关'}
              </button>
              <button
                className={`pref-btn ${prefs.fx ? 'active' : ''}`}
                onClick={onToggleFx}
                title="弹道/枪口火光/命中火花/受击与击杀反馈"
              >
                {prefs.fx ? '✨ 特效开' : '💤 特效关'}
              </button>
            </div>
            <p className="muted">音效与特效偏好只对本游戏生效，设置会保存在你的浏览器中。</p>
          </section>
        </div>

        <details className="rules">
          <summary>📜 规则与操作</summary>
          <ul>
            <li>先到击杀线获胜（自由混战看个人、团队死斗看队伍），超时按分数判定。</li>
            <li>武器：1 步枪（自动）· 2 狙击枪（爆头 250）· 3 手枪（无限备弹）· 4 匕首（近战）。</li>
            <li>右键开镜（狙击/步枪更准），R 换弹；爆头伤害翻倍以上，远距离伤害衰减。</li>
            <li>Q 主动技能、E 终极技（随时间/伤害/击杀充能）；按所选复活等待时间重生。</li>
          </ul>
          <div className="ccf-controls-grid">
            <span>🖱️ 鼠标：环顾 / 左键射击 / 右键开镜</span>
            <span>⌨️ WASD 移动 · 空格跳跃</span>
            <span>🔢 滚轮或 1-4 切枪 · R 换弹 · 按住 Tab 战绩</span>
            <span>⚡ Q 技能 · E 终极技 · Tab 计分板</span>
          </div>
          <h3>五位英雄</h3>
          {HERO_LIST.map((h) => (
            <div key={h.key} className="ccf-hero-line">
              <b>{h.emoji} {h.name}</b>
              <span>{h.role} · {h.hp}HP · Q {h.skillName}（{h.skillDesc}）· E {h.ultName}（{h.ultDesc}）</span>
            </div>
          ))}
          <h3>四种武器</h3>
          {WEAPON_IDS.map((w) => (
            <div key={w} className="ccf-hero-line">
              <b>{WEAPON_DEFS[w].emoji} {WEAPON_DEFS[w].name}</b>
              <span>
                伤害 {WEAPON_DEFS[w].damage} · 射速 {Math.round(1000 / WEAPON_DEFS[w].interval)}/秒 · 弹匣 {WEAPON_DEFS[w].magSize === Infinity ? '∞' : WEAPON_DEFS[w].magSize} · {WEAPON_DEFS[w].desc}
              </span>
            </div>
          ))}
        </details>

      </div>
    </div>
  );
}

// 保持 chooseAIInputs 引用（本地扩展点，未来本地观战/回放可能用到）
void chooseAIInputs;
