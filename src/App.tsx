import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Cup, GameState, Lane } from "./types";

const LANE_COUNT = 4;
const MAX_STACK_HEIGHT = 6;
const DROP_DELAY_MS = 500;
const DROP_ANIM_HEIGHT = 24;
const DROP_ANIM_DURATION_MS = 1100;

type DropResult = {
  lanes: Lane[];
  lost: boolean;
  message: string;
  spawnedId?: string;
  spawnedVisualSize?: number;
};

const detectForcedLoss = (lanes: Lane[], nextLane: number): string | null => {
  const lane = lanes[nextLane];
  if (!lane) return null;
  if (lane.length >= MAX_STACK_HEIGHT) {
    return `次の落下先レーン${nextLane + 1}は高さ${MAX_STACK_HEIGHT}で受け皿なし。落下前に敗北します。`;
  }
  const top = lane[lane.length - 1];
  if (top && top.linked && top.size === 1) {
    return `次の落下先レーン${nextLane + 1}はロックされた1がトップです。1を落とせません。`;
  }
  return null;
};

const sizeColors: Record<number, string> = {
  1: "#fb7185",
  2: "#38bdf8",
  3: "#34d399",
  4: "#fbbf24",
  5: "#a78bfa",
};

const sizeGradients: Record<number, [string, string]> = {
  1: ["#fb7185", "#f472b6"],
  2: ["#38bdf8", "#60a5fa"],
  3: ["#34d399", "#2dd4bf"],
  4: ["#fbbf24", "#fb923c"],
  5: ["#a78bfa", "#c084fc"],
};

type CupDimensions = {
  height: number;
  radiusTop: number;
  radiusBottom: number;
};

const cupDimensionsForSize = (size: number): CupDimensions => {
  const base = 0.7 + size * 0.12;
  return {
    height: 1.18 + size * 0.16,
    radiusTop: base + 0.08,
    radiusBottom: base,
  };
};

const numberTextureCache = new Map<string, THREE.Texture>();

const createNumberSprite = (text: string, color: string): THREE.Mesh => {
  if (numberTextureCache.has(text + color)) {
    const cached = numberTextureCache.get(text + color) as THREE.Texture;
    const mat = new THREE.MeshBasicMaterial({
      map: cached,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  }
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = 10;
    ctx.font = "900 156px 'Space Grotesk', 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(text, size / 2, size / 2 + 4);
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  numberTextureCache.set(text + color, texture);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
};

const disposeObject = (obj: THREE.Object3D) => {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).geometry) {
      (child as THREE.Mesh).geometry.dispose();
    }
    if ((child as THREE.Mesh).material) {
      const material = (child as THREE.Mesh).material as THREE.Material;
      material.dispose();
    }
  });
};

const CupLaneCanvas = ({
  lane,
  laneIndex,
  isSelected,
  isDanger,
  dropAnimatingCupId,
  dropAnimatingLane,
  dropAnimatingVisualSize,
  onClick,
  onDropAnimEnd,
}: {
  lane: Lane;
  laneIndex: number;
  isSelected: boolean;
  isDanger: boolean;
  dropAnimatingCupId: string | null;
  dropAnimatingLane: number | null;
  dropAnimatingVisualSize: number | null;
  onClick: (laneIndex: number) => void;
  onDropAnimEnd: () => void;
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastObjectsRef = useRef<THREE.Object3D[]>([]);
  const cupGroupMapRef = useRef<Map<string, THREE.Group>>(new Map());
  const targetYMapRef = useRef<Map<string, number>>(new Map());
  const dropFrameRef = useRef<number | null>(null);

  const startDropAnimation = (
    group: THREE.Group,
    baseY: number,
    onEnd?: () => void
  ) => {
    if (dropFrameRef.current) cancelAnimationFrame(dropFrameRef.current);
    const startY = baseY + DROP_ANIM_HEIGHT;
    group.position.y = startY;
    const start = performance.now();
    const duration = DROP_ANIM_DURATION_MS;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      group.position.y = startY + (baseY - startY) * eased;
      if (t < 1) {
        dropFrameRef.current = requestAnimationFrame(step);
      } else {
        group.position.y = baseY;
        dropFrameRef.current = null;
        if (onEnd) onEnd();
      }
    };
    dropFrameRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1225");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      26,
      mount.clientWidth / mount.clientHeight,
      0.1,
      140
    );
    camera.position.set(0, 10.5, 15);
    camera.lookAt(0, 3, 0);

    const ambient = new THREE.AmbientLight("#e5ecff", 0.55);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight("#ffffff", 0.8);
    dir.position.set(4, 10, 6);
    scene.add(dir);
    const rim = new THREE.DirectionalLight("#7dd3fc", 0.35);
    rim.position.set(-6, 6, -4);
    scene.add(rim);

    const grid = new THREE.GridHelper(16, 16, "#1e293b", "#1e293b");
    grid.position.y = -0.01;
    grid.material.opacity = 0.18;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === mount) {
          const { width, height } = entry.contentRect;
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
      }
    });
    resizeObserver.observe(mount);

    const animate = () => {
      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (dropFrameRef.current) cancelAnimationFrame(dropFrameRef.current);
      resizeObserver.disconnect();
      lastObjectsRef.current.forEach(disposeObject);
      lastObjectsRef.current = [];
      targetYMapRef.current.clear();
      cupGroupMapRef.current.clear();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    lastObjectsRef.current.forEach((obj) => {
      scene.remove(obj);
      disposeObject(obj);
    });
    lastObjectsRef.current = [];

    cupGroupMapRef.current.clear();
    targetYMapRef.current.clear();
    let yOffset = 0;

    lane.forEach((cup) => {
      const dims = cupDimensionsForSize(cup.size);
      const wallThickness = 0.1;
      const colorHex = sizeColors[cup.size] ?? "#94a3b8";

      const outerGeo = new THREE.CylinderGeometry(
        dims.radiusTop,
        dims.radiusBottom,
        dims.height,
        44,
        1,
        true
      );
      const outerMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.18,
        metalness: 0.1,
        emissive: new THREE.Color(colorHex).multiplyScalar(0.05),
        transparent: true,
        opacity: 0.54,
        transmission: 0.85,
        thickness: 0.22,
        side: THREE.DoubleSide,
      });
      const outerMesh = new THREE.Mesh(outerGeo, outerMat);

      const innerGeo = new THREE.CylinderGeometry(
        dims.radiusTop - wallThickness,
        dims.radiusBottom - wallThickness,
        dims.height * 0.82,
        40,
        1,
        true
      );
      const innerMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("#0a0f1f"),
        roughness: 0.8,
        metalness: 0.01,
        side: THREE.BackSide,
      });
      const innerMesh = new THREE.Mesh(innerGeo, innerMat);
      innerMesh.position.y = -dims.height * 0.18;

      const rimGeo = new THREE.RingGeometry(
        dims.radiusTop - 0.05,
        dims.radiusTop + 0.05,
        64
      );
      const rimMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 0.16,
        roughness: 0.18,
        metalness: 0.32,
        side: THREE.DoubleSide,
      });
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      rimMesh.rotation.x = -Math.PI / 2;
      rimMesh.position.y = dims.height / 2 + 0.001;

      // 底面ディスクで透けを防止
      const baseGeo = new THREE.CircleGeometry(
        Math.max(0.001, dims.radiusBottom - wallThickness * 0.45),
        44
      );
      const baseMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex).offsetHSL(0, -0.06, -0.12),
        roughness: 0.46,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.rotation.x = -Math.PI / 2;
      baseMesh.position.y = -dims.height / 2;

      const group = new THREE.Group();
      group.add(outerMesh);
      group.add(innerMesh);
      group.add(rimMesh);
      group.add(baseMesh);
      cupGroupMapRef.current.set(cup.id, group);

      const label = createNumberSprite(String(cup.size), "#ffffff");
      const labelSize = Math.max(0.9, 0.55 + cup.size * 0.1);
      label.scale.set(labelSize, labelSize, labelSize);
      label.position.set(0, dims.height * 0.2, dims.radiusTop + 0.18);
      label.renderOrder = 5;
      group.add(label);

      if (cup.linked) {
        const lockGeo = new THREE.TorusGeometry(dims.radiusBottom * 0.95, 0.08, 12, 40);
        const lockMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#f97316"),
          emissive: new THREE.Color("#f97316"),
          emissiveIntensity: 0.25,
          roughness: 0.3,
          metalness: 0.2,
        });
        const lockMesh = new THREE.Mesh(lockGeo, lockMat);
        lockMesh.rotation.x = Math.PI / 2;
        lockMesh.position.y = -dims.height / 2 + 0.16;
        group.add(lockMesh);
      }

      const yPos = yOffset + dims.height / 2;
      group.position.set(0, yPos, 0);
      group.name = cup.id;

      const shouldAnimate =
        dropAnimatingCupId &&
        dropAnimatingLane === laneIndex &&
        cup.id === dropAnimatingCupId;

      targetYMapRef.current.set(cup.id, yPos);
      scene.add(group);
      lastObjectsRef.current.push(group);

      if (shouldAnimate) {
        if (dropAnimatingVisualSize) {
          // actual cup stays; spawn falling ghost of the visual size
          const ghostDims = cupDimensionsForSize(dropAnimatingVisualSize);
          const ghostColor = sizeColors[dropAnimatingVisualSize] ?? "#94a3b8";
          const ghostGeo = new THREE.CylinderGeometry(
            ghostDims.radiusTop,
            ghostDims.radiusBottom,
            ghostDims.height,
            32,
            1,
            true
          );
          const ghostMat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(ghostColor),
            roughness: 0.18,
            metalness: 0.1,
            transparent: true,
            opacity: 0.68,
            transmission: 0.72,
            thickness: 0.22,
            side: THREE.DoubleSide,
          });
          const ghost = new THREE.Mesh(ghostGeo, ghostMat);
          const labelGhost = createNumberSprite(
            String(dropAnimatingVisualSize),
            "#ffffff"
          );
          labelGhost.scale.set(
            Math.max(0.9, 0.55 + dropAnimatingVisualSize * 0.1),
            Math.max(0.9, 0.55 + dropAnimatingVisualSize * 0.1),
            Math.max(0.9, 0.55 + dropAnimatingVisualSize * 0.1)
          );
          labelGhost.position.set(
            0,
            ghostDims.height * 0.2,
            ghostDims.radiusTop + 0.18
          );
          ghost.add(labelGhost);

          ghost.position.set(0, yPos + DROP_ANIM_HEIGHT + ghostDims.height / 2, 0);
          scene.add(ghost);
          const start = performance.now();
          const duration = DROP_ANIM_DURATION_MS;
          const startY = ghost.position.y;
          const targetY = yPos + ghostDims.height / 2;

          const animateGhost = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            ghost.position.y = startY + (targetY - startY) * eased;
            if (t < 1) {
              requestAnimationFrame(animateGhost);
            } else {
              ghost.position.y = targetY;
              scene.remove(ghost);
              disposeObject(ghost);
              onDropAnimEnd();
            }
          };
          requestAnimationFrame(animateGhost);
        } else {
          startDropAnimation(group, yPos, onDropAnimEnd);
        }
      }

      yOffset += dims.height * 0.6;
    });
  }, [lane, dropAnimatingCupId, dropAnimatingLane, dropAnimatingVisualSize, laneIndex, onDropAnimEnd]);

  return (
    <button
      type="button"
      onClick={() => onClick(laneIndex)}
      className={`relative flex flex-col rounded-2xl border border-slate-700/60 px-3 pt-3 transition focus:outline-none lane-surface ${
        isSelected ? "ring-4 ring-cyan-300/80" : "hover:ring-2 hover:ring-cyan-200/70"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>Lane {laneIndex + 1}</span>
        {isDanger ? (
          <span className="lane-highlight font-semibold text-rose-300">▼ DROP</span>
        ) : (
          <span className="text-slate-500">safe</span>
        )}
      </div>
      <div className="relative mt-2 h-[540px] overflow-hidden rounded-xl bg-gradient-to-b from-slate-900/80 to-slate-950/95">
        <div ref={mountRef} className="h-full w-full" />
      </div>
    </button>
  );
};

// Top cup is always included; walk downward while linked cups continue.
export const getMovingGroupStartIndex = (stack: Cup[]): number => {
  if (stack.length === 0) return -1;
  let idx = stack.length - 1;
  while (idx > 0 && stack[idx].linked) {
    idx -= 1;
  }
  return idx;
};

const pickNextLane = (exclude: number | null): number => {
  const candidates = Array.from({ length: LANE_COUNT }, (_, i) => i).filter(
    (lane) => lane !== exclude
  );
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
};

const checkWin = (lanes: Lane[]): boolean => {
  return lanes.some((lane) => {
    if (lane.length < 5) return false;
    for (let i = 0; i <= lane.length - 5; i += 1) {
      const slice = lane.slice(i, i + 5);
      const isPattern =
        slice[0].size === 5 &&
        slice[1].size === 4 &&
        slice[2].size === 3 &&
        slice[3].size === 2 &&
        slice[4].size === 1;
      const linkedOk =
        slice[1].linked &&
        slice[2].linked &&
        slice[3].linked &&
        slice[4].linked;
      if (isPattern && linkedOk) {
        return true;
      }
    }
    return false;
  });
};

const applyDropToLanes = (
  lanes: Lane[],
  laneIndex: number,
  createId: () => string
): DropResult => {
  const updated = lanes.map((lane) => [...lane]);
  const lane = updated[laneIndex];

  if (lane.length >= MAX_STACK_HEIGHT) {
    return {
      lanes: updated,
      lost: true,
      message: `レーン${laneIndex + 1}が高さオーバー。`,
    };
  }

  const dropTop = lane[lane.length - 1];

  if (!dropTop) {
    const newId = createId();
    lane.push({ id: newId, size: 1, linked: false });
    return {
      lanes: updated,
      lost: false,
      spawnedId: newId,
      message: `レーン${laneIndex + 1}に1が落下。`,
    };
  }

  if (dropTop.linked) {
    if (dropTop.size === 1) {
      return {
        lanes: updated,
        lost: true,
        message: `ロックされた1の上に1が落下して敗北。`,
      };
    }
    const shouldLink = dropTop.size === 2;
      const newId = createId();
      lane.push({ id: newId, size: 1, linked: shouldLink });
      const overHeight = lane.length > MAX_STACK_HEIGHT;
      return {
        lanes: updated,
        lost: overHeight,
        spawnedId: newId,
        message: `レーン${laneIndex + 1}に1が中に入りました。`,
      };
    }

  if (dropTop.size === 1) {
    lane.pop();
    const below = lane[lane.length - 1];
    const newId = createId();
    const newCup: Cup = {
      id: newId,
      size: 2,
      linked: below ? below.size - 2 === 1 : false,
    };
    lane.push(newCup);
    const overHeight = lane.length > MAX_STACK_HEIGHT;
    return {
      lanes: updated,
      lost: overHeight,
      spawnedId: newId,
      spawnedVisualSize: 1,
      message: `レーン${laneIndex + 1}で1と1が合体し2になりました。`,
    };
  }

  const shouldLink = dropTop.size === 2;
    lane.push({ id: createId(), size: 1, linked: shouldLink });
    const newId = lane[lane.length - 1].id;
    const overHeight = lane.length > MAX_STACK_HEIGHT;
    return {
      lanes: updated,
      lost: overHeight,
      spawnedId: newId,
      message: `レーン${laneIndex + 1}に1が中に入りました。`,
    };
  };

// Deprecated 2D cup view removed; replaced by Three.js canvas (CupLaneCanvas).

const App = () => {
  const [lanes, setLanes] = useState<Lane[]>(
    () => Array.from({ length: LANE_COUNT }, () => [])
  );
  const [nextDropLane, setNextDropLane] = useState(0);
  const [selectedLane, setSelectedLane] = useState<number | null>(null);
  const [gameState, setGameState] = useState<GameState>("start");
  const [isDropping, setIsDropping] = useState(false);
  const [turn, setTurn] = useState(1);
  const [message, setMessage] = useState("タップして開始");
  const [dropAnimatingCupId, setDropAnimatingCupId] = useState<string | null>(
    null
  );
  const [dropAnimatingLane, setDropAnimatingLane] = useState<number | null>(
    null
  );
  const [dropAnimatingVisualSize, setDropAnimatingVisualSize] = useState<
    number | null
  >(null);

  const idRef = useRef(1);

  const nextId = () => {
    const id = idRef.current;
    idRef.current += 1;
    return `cup-${id}`;
  };

  useEffect(() => {
    initGame();
  }, []);

  useEffect(() => {
    if (gameState !== "playing") return;
    const forced = detectForcedLoss(lanes, nextDropLane);
    if (forced) {
      setGameState("lost");
      setMessage(forced);
      setIsDropping(false);
      setSelectedLane(null);
    }
  }, [lanes, nextDropLane, gameState]);

  const initGame = () => {
    const empty = Array.from({ length: LANE_COUNT }, () => [] as Cup[]);
    idRef.current = 1;
    const firstLane = pickNextLane(null);
    const first = applyDropToLanes(empty, firstLane, nextId);

    const secondLane = pickNextLane(null);
    const second = applyDropToLanes(first.lanes, secondLane, nextId);

    const upcoming = pickNextLane(secondLane);

    setLanes(second.lanes);
    setNextDropLane(upcoming);
    setSelectedLane(null);
    setGameState("playing");
    setIsDropping(false);
    setTurn(1);
    setMessage("ゲーム開始！移動元を選んでください。");
    setDropAnimatingCupId(null);
    setDropAnimatingLane(null);
    setDropAnimatingVisualSize(null);
  };

  const handleLaneClick = (index: number) => {
    if (gameState !== "playing" || isDropping) return;

    if (selectedLane === null) {
      if (lanes[index].length === 0) {
        setMessage("空のレーンは選べません。");
        return;
      }
      setSelectedLane(index);
      setMessage(`レーン${index + 1}を選択しました。移動先をタップ。`);
      return;
    }

    if (selectedLane === index) {
      setSelectedLane(null);
      setMessage("スキップ。落下に進みます。");
      proceedToDrop();
      return;
    }

    handleMove(selectedLane, index);
  };

  const handleMove = (from: number, to: number) => {
    const source = lanes[from];
    if (source.length === 0) {
      setMessage("移動元にコップがありません。");
      setSelectedLane(null);
      return;
    }

    const target = lanes[to];
    const startIndex = getMovingGroupStartIndex(source);
    const movingGroup = source.slice(startIndex);
    const baseCup = movingGroup[0];
    const targetTop = target[target.length - 1] ?? null;

    if (!targetTop) {
      const newLanes = lanes.map((lane) => [...lane]);
      const newSource = source.slice(0, startIndex);
      const moved = movingGroup.map((cup) => ({ ...cup }));
      newLanes[from] = newSource;
      newLanes[to] = [...target, ...moved];

      setLanes(newLanes);
      setSelectedLane(null);
      setMessage(`レーン${from + 1}から${to + 1}へ移動。`);
      proceedToDrop();
      return;
    }

    if (baseCup.size > targetTop.size) {
      setMessage("大きいコップは小さい上に置けません。");
      setSelectedLane(null);
      return;
    }

    if (baseCup.size < targetTop.size) {
      const newLanes = lanes.map((lane) => [...lane]);
      const newSource = source.slice(0, startIndex);
      const rebuiltGroup: Cup[] = [];

      movingGroup.forEach((cup, idx) => {
        const belowCup = idx === 0 ? targetTop : rebuiltGroup[idx - 1];
        const shouldLink = belowCup ? belowCup.size - cup.size === 1 : false;
        const rebuilt: Cup = { ...cup, linked: shouldLink };
        rebuiltGroup.push(rebuilt);
      });

      newLanes[from] = newSource;
      newLanes[to] = [...target, ...rebuiltGroup];

      setLanes(newLanes);
      setSelectedLane(null);
      setMessage(`レーン${from + 1}から${to + 1}へ移動しました。`);
      proceedToDrop();
      return;
    }

    if (movingGroup.length > 1) {
      setMessage("連結グループは同サイズ合体できません。");
      setSelectedLane(null);
      return;
    }

    if (baseCup.size === 5) {
      setMessage("サイズ5はこれ以上合体できません。");
      setSelectedLane(null);
      return;
    }

    const newLanes = lanes.map((lane) => [...lane]);
    const newSource = source.slice(0, startIndex);
    const newTarget = target.slice(0, -1); // remove targetTop
    const below = newTarget[newTarget.length - 1];
    const mergedSize = baseCup.size + 1;
    const merged: Cup = {
      id: nextId(),
      size: mergedSize,
      linked: below ? below.size - mergedSize === 1 : false,
    };

    newLanes[from] = newSource;
    newLanes[to] = [...newTarget, merged];

    setLanes(newLanes);
    setSelectedLane(null);
    setMessage(
      `レーン${from + 1}と${to + 1}の${baseCup.size}が合体し${mergedSize}に。`
    );
    proceedToDrop();
  };

  const proceedToDrop = () => {
    setIsDropping(true);
    setTimeout(() => {
      let lastDrop: DropResult | null = null;
      setLanes((current) => {
        const dropResult = applyDropToLanes(current, nextDropLane, nextId);
        lastDrop = dropResult;
        const updated = dropResult.lanes;

        if (dropResult.lost) {
          setGameState("lost");
          setMessage(dropResult.message);
          setDropAnimatingCupId(null);
          setDropAnimatingLane(null);
          setDropAnimatingVisualSize(null);
          setIsDropping(false);
          return updated;
        }

        if (checkWin(updated)) {
          setGameState("won");
          setMessage("勝利！5-4-3-2-1が揃いました。");
          setDropAnimatingCupId(null);
          setDropAnimatingLane(null);
          setDropAnimatingVisualSize(null);
          setIsDropping(false);
          return updated;
        }

        const upcoming = pickNextLane(nextDropLane);

        setNextDropLane(upcoming);
        setTurn((t) => t + 1);
        setMessage(dropResult.message);
        setDropAnimatingCupId(dropResult.spawnedId ?? null);
        setDropAnimatingLane(dropResult.spawnedId ? nextDropLane : null);
        setDropAnimatingVisualSize(
          dropResult.spawnedId ? dropResult.spawnedVisualSize ?? null : null
        );
        setIsDropping(false);
        return updated;
      });

      if (lastDrop?.spawnedId && !lastDrop.spawnedVisualSize) {
        // no ghost animation needed; clear immediately
        setDropAnimatingVisualSize(null);
        setDropAnimatingCupId(null);
        setDropAnimatingLane(null);
      }
    }, DROP_DELAY_MS);
  };

  const statusColor =
    gameState === "won"
      ? "text-emerald-300"
      : gameState === "lost"
      ? "text-rose-300"
      : "text-cyan-200";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">CUP STACK EX</h1>
            <p className={`text-sm ${statusColor}`}>
              状態: {gameState === "playing" ? "進行中" : gameState}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-800 px-3 py-2 text-sm">
              ターン: {turn}
            </span>
            <button
              type="button"
              onClick={initGame}
              className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              リセット / 開始
            </button>
          </div>
        </header>

        <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-200">
            <span className="rounded-full bg-slate-800 px-3 py-2">
              次の落下レーン:{" "}
              <strong className="text-rose-300">{nextDropLane + 1}</strong>
            </span>
            <span className="rounded-full bg-slate-800 px-3 py-2">
              選択: {selectedLane !== null ? `レーン${selectedLane + 1}` : "なし"}
            </span>
            {isDropping ? (
              <span className="rounded-full bg-amber-500/80 px-3 py-2 text-slate-950">
                落下演出中...
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {lanes.map((lane, idx) => (
              <CupLaneCanvas
                key={`lane-${idx}`}
                lane={lane}
                laneIndex={idx}
                isDanger={nextDropLane === idx}
                isSelected={selectedLane === idx}
                dropAnimatingCupId={dropAnimatingCupId}
                dropAnimatingLane={dropAnimatingLane}
                dropAnimatingVisualSize={dropAnimatingVisualSize}
                onClick={handleLaneClick}
                onDropAnimEnd={() => {
                  setDropAnimatingVisualSize(null);
                  setDropAnimatingCupId(null);
                  setDropAnimatingLane(null);
                }}
              />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-sm text-slate-200">{message}</p>
          {gameState !== "playing" ? (
            <p className="mt-2 text-xs text-slate-400">
              リセットを押すと新しいゲームが始まります。
            </p>
          ) : null}
        </section>
      </div>
      {gameState === "lost" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl border border-rose-400/50 bg-slate-900/95 px-8 py-10 text-center shadow-2xl">
            <p className="text-sm uppercase tracking-[0.25em] text-rose-200">Game Over</p>
            <p className="mt-3 text-xl font-semibold text-rose-100">
              {message || "次の落下ができません。"}
            </p>
            <button
              type="button"
              onClick={initGame}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-rose-400 px-5 py-2 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-rose-300"
            >
              リセット
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default App;
