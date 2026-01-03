import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cup, Lane, GameState } from "./types";

const LANE_COUNT = 4;
const MAX_STACK_HEIGHT = 6;

const MOVE_MS = 180;
const MERGE_MS = 140;
const MERGE_FLASH_MS = 80;
const DROP_MS = 220;
const SETTLE_MS = 120;
const LINK_MS = 120;
const LINK_BUMP_MS = 80;

const sizeColors: Record<number, string> = {
  1: "#fb7185",
  2: "#38bdf8",
  3: "#34d399",
  4: "#fbbf24",
  5: "#a78bfa",
};

type Phase =
  | "select"
  | "resolving"
  | "animating"
  | "end";

type AnimEvent =
  | { type: "move"; id: string; toLane: number; toIndex: number; duration: number }
  | { type: "merge"; id: string; newSize: number; lane: number; index: number; duration: number }
  | { type: "drop"; id: string; lane: number; toIndex: number; visualSize: number; duration: number }
  | { type: "settle"; id: string; lane: number; index: number; duration: number }
  | { type: "link"; id: string; lane: number; index: number; duration: number }
  | { type: "gameOver"; message: string };

type MoveEvent = Extract<AnimEvent, { type: "move" }>;

type ResolveResult = {
  nextBoard: Lane[];
  events: AnimEvent[];
  message: string;
  lost?: boolean;
  won?: boolean;
};

type SpriteCup = Cup & {
  lane: number;
  index: number;
  isGhost?: boolean;
};

type RNG = () => number;

const seeded = (seed: number): RNG => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

type LaneMetrics = { laneWidth: number; gap: number; slotHeight: number; height: number; paddingBottom: number };

const slotPosition = (lane: number, index: number, m: LaneMetrics) => {
  const x = lane * (m.laneWidth + m.gap) + m.laneWidth * 0.15;
  const y = m.height - m.paddingBottom - (index + 1) * m.slotHeight;
  return { x, y };
};

const cloneBoard = (board: Lane[]) => board.map((l) => [...l]);

const getMovingGroupStartIndex = (stack: Cup[]): number => {
  if (stack.length === 0) return -1;
  let idx = stack.length - 1;
  while (idx > 0 && stack[idx].linked) {
    idx -= 1;
  }
  return idx;
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
      if (isPattern && linkedOk) return true;
    }
    return false;
  });
};

const resolveMove = (
  board: Lane[],
  from: number,
  to: number
): ResolveResult => {
  const lanes = cloneBoard(board);
  const source = lanes[from];
  const target = lanes[to];
  if (!source || source.length === 0) {
    return { nextBoard: lanes, events: [], message: "移動元が空です。" };
  }
  const startIdx = getMovingGroupStartIndex(source);
  const moving = source.slice(startIdx);
  const base = moving[0];
  const targetTop = target[target.length - 1] ?? null;

  if (!targetTop) {
    lanes[from] = source.slice(0, startIdx);
    lanes[to] = [...target, ...moving];
    const events: AnimEvent[] = moving.map((m, i) => ({
      type: "move",
      id: m.id,
      toLane: to,
      toIndex: target.length + i,
      duration: MOVE_MS,
    }));
    return {
      nextBoard: lanes,
      events,
      message: `レーン${from + 1}→${to + 1} へ移動。`,
    };
  }

  if (base.size > targetTop.size) {
    return {
      nextBoard: lanes,
      events: [],
      message: "大きいコップは小さい上に置けません。",
    };
  }

  if (base.size < targetTop.size) {
    const rebuilt: Cup[] = [];
    moving.forEach((cup, idx) => {
      const below = idx === 0 ? targetTop : rebuilt[idx - 1];
      rebuilt.push({ ...cup, linked: below ? below.size - cup.size === 1 : false });
    });
    lanes[from] = source.slice(0, startIdx);
    lanes[to] = [...target, ...rebuilt];
    const events: AnimEvent[] = rebuilt.map((m, i) => ({
      type: "move",
      id: m.id,
      toLane: to,
      toIndex: target.length + i,
      duration: MOVE_MS,
    }));
    const linkEvents: AnimEvent[] = rebuilt
      .map((m, i) => {
        const idx = target.length + i;
        return m.linked
          ? ({ type: "link", id: m.id, lane: to, index: idx, duration: LINK_MS } as AnimEvent)
          : null;
      })
      .filter(Boolean) as AnimEvent[];
    return {
      nextBoard: lanes,
      events: [...events, ...linkEvents],
      message: `レーン${from + 1}→${to + 1} へ移動。`,
    };
  }

  if (moving.length > 1) {
    return {
      nextBoard: lanes,
      events: [],
      message: "連結グループは同サイズ合体できません。",
    };
  }

  if (base.size === 5) {
    return { nextBoard: lanes, events: [], message: "サイズ5は合体不可。" };
  }

  if (targetTop.linked || base.linked) {
    return {
      nextBoard: lanes,
      events: [],
      message: "ロックされたコップとは合体できません。",
    };
  }

  lanes[from] = source.slice(0, startIdx);
  const targetWithoutTop = target.slice(0, -1);
  const below = targetWithoutTop[targetWithoutTop.length - 1];
  const mergedSize = base.size + 1;
  const merged: Cup = {
    id: `${base.id}-m`,
    size: mergedSize,
    linked: below ? below.size - mergedSize === 1 : false,
  };
  lanes[to] = [...targetWithoutTop, merged];

  const events: AnimEvent[] = [
    {
      type: "merge",
      id: base.id,
      newSize: mergedSize,
      lane: to,
      index: targetWithoutTop.length,
      duration: MERGE_MS,
    },
  ];
  if (merged.linked) {
    events.push({
      type: "link",
      id: merged.id,
      lane: to,
      index: targetWithoutTop.length,
      duration: LINK_MS,
    });
  }

  return {
    nextBoard: lanes,
    events,
    message: `レーン${from + 1}で${base.size}+${targetTop.size}→${mergedSize}。`,
  };
};

const resolveDrop = (
  board: Lane[],
  dropLane: number,
  createId: () => string
): ResolveResult => {
  const lanes = cloneBoard(board);
  const lane = lanes[dropLane];
  if (lane.length >= MAX_STACK_HEIGHT) {
    return {
      nextBoard: lanes,
      events: [{ type: "gameOver", message: `レーン${dropLane + 1}が高さ上限です。` }],
      message: "高さオーバー。",
      lost: true,
    };
  }
  const top = lane[lane.length - 1];
  const events: AnimEvent[] = [];

  if (!top) {
    const id = createId();
    lane.push({ id, size: 1, linked: false });
    events.push({
      type: "drop",
      id,
      lane: dropLane,
      toIndex: lane.length - 1,
      visualSize: 1,
      duration: DROP_MS,
    });
    return { nextBoard: lanes, events, message: "1が落下。" };
  }

  if (top.linked && top.size === 1) {
    return {
      nextBoard: lanes,
      events: [{ type: "gameOver", message: "ロックされた1の上に1は落とせません。" }],
      message: "ロック1に衝突し敗北。",
      lost: true,
    };
  }

  if (top.size === 1) {
    lane.pop();
    const id = createId();
    const below = lane[lane.length - 1];
    const newCup: Cup = {
      id,
      size: 2,
      linked: below ? below.size - 2 === 1 : false,
    };
    lane.push(newCup);
    events.push({
      type: "drop",
      id,
      lane: dropLane,
      toIndex: lane.length - 1,
      visualSize: 1,
      duration: DROP_MS,
    });
    events.push({
      type: "merge",
      id,
      newSize: 2,
      lane: dropLane,
      index: lane.length - 1,
      duration: MERGE_MS,
    });
    if (newCup.linked) {
      events.push({
        type: "link",
        id,
        lane: dropLane,
        index: lane.length - 1,
        duration: LINK_MS,
      });
    }
    return { nextBoard: lanes, events, message: "1と1が合体し2に。" };
  }

  const id = createId();
  const link = top.size === 2;
  lane.push({ id, size: 1, linked: link });
  events.push({
    type: "drop",
    id,
    lane: dropLane,
    toIndex: lane.length - 1,
    visualSize: 1,
    duration: DROP_MS,
  });
  if (link) {
    events.push({
      type: "link",
      id,
      lane: dropLane,
      index: lane.length - 1,
      duration: LINK_MS,
    });
  }
  return { nextBoard: lanes, events, message: "1が落下。" };
};

const detectForcedLoss = (lanes: Lane[], nextLane: number): string | null => {
  // quick fail: height already max
  const lane = lanes[nextLane];
  if (lane.length >= MAX_STACK_HEIGHT) {
    return `次の落下先レーン${nextLane + 1}は高さ${MAX_STACK_HEIGHT}で受け皿なし。落下前に敗北します。`;
  }
  const top = lane[lane.length - 1];
  if (top && top.linked && top.size === 1) {
    // simulate whether any move (or skip) can avoid loss
    const createId = (() => {
      let t = 1_000_000;
      return () => `sim-${t++}`;
    })();
    // option 1: skip move
    const skipDrop = resolveDrop(lanes, nextLane, createId);
    if (!skipDrop.lost) return null;

    // option 2: any legal move that leads to safe drop
    for (let from = 0; from < LANE_COUNT; from += 1) {
      if (lanes[from].length === 0) continue;
      for (let to = 0; to < LANE_COUNT; to += 1) {
        if (from === to) continue;
        const moveResult = resolveMove(lanes, from, to);
        if (moveResult.events.length === 0) continue; // illegal
        const afterMove = moveResult.nextBoard;
        const dropResult = resolveDrop(afterMove, nextLane, createId);
        if (!dropResult.lost) {
          return null; // at least one path avoids loss
        }
      }
    }
    return `次の落下先レーン${nextLane + 1}はロックされた1がトップです。1を落とせません。`;
  }
  return null;
};

const buildSpritesFromBoard = (board: Lane[]): Record<string, SpriteCup> => {
  const sprites: Record<string, SpriteCup> = {};
  board.forEach((lane, laneIdx) => {
    lane.forEach((cup, idx) => {
      sprites[cup.id] = { ...cup, lane: laneIdx, index: idx };
    });
  });
  return sprites;
};

const App = () => {
  const [board, setBoard] = useState<Lane[]>(
    () => Array.from({ length: LANE_COUNT }, () => [])
  );
  const [sprites, setSprites] = useState<Record<string, SpriteCup>>({});
  const [phase, setPhase] = useState<Phase>("select");
  const [gameState, setGameState] = useState<GameState>("start");
  const [message, setMessage] = useState("タップして開始");
  const [selectedLane, setSelectedLane] = useState<number | null>(null);
  const [nextDropLane, setNextDropLane] = useState(0);
  const [turn, setTurn] = useState(1);
  const [showEndOverlay, setShowEndOverlay] = useState(false);
  const idRef = useRef(1);
  const rngRef = useRef<RNG>(() => Math.random());
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<LaneMetrics>({
    laneWidth: 200,
    gap: 16,
    slotHeight: 96,
    height: 600,
    paddingBottom: 24,
  });

  const slotCache = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      for (let idx = 0; idx < MAX_STACK_HEIGHT; idx += 1) {
        const { x, y } = slotPosition(lane, idx, metrics);
        positions[`${lane}-${idx}`] = { x, y };
      }
    }
    return positions;
  }, [metrics]);

  const linkedGroupIds = useMemo(() => {
    const ids = new Set<string>();
    board.forEach((lane) => {
      lane.forEach((cup, idx) => {
        if (cup.linked) {
          ids.add(cup.id);
          const below = lane[idx - 1];
          if (below) ids.add(below.id);
        }
        const above = lane[idx + 1];
        if (above && above.linked) {
          ids.add(cup.id);
        }
      });
    });
    return ids;
  }, [board]);

  const nextId = () => {
    const id = idRef.current;
    idRef.current += 1;
    return `cup-${id}`;
  };

  const syncSpritesToBoard = (next: Lane[]) => {
    setSprites(buildSpritesFromBoard(next));
  };

  const pickNextLane = (exclude: number | null) => {
    const rand = rngRef.current();
    const candidates = Array.from({ length: LANE_COUNT }, (_, i) => i).filter(
      (i) => i !== exclude
    );
    const idx = Math.floor(rand * candidates.length);
    return candidates[idx];
  };

  const initGame = () => {
    const seed = Date.now();
    rngRef.current = seeded(seed);
    const empty = Array.from({ length: LANE_COUNT }, () => [] as Cup[]);
    const laneA = pickNextLane(null);
    const first = resolveDrop(empty, laneA, nextId).nextBoard;
    const laneB = pickNextLane(laneA);
    const second = resolveDrop(first, laneB, nextId).nextBoard;
    const upcoming = pickNextLane(laneB);

    setBoard(second);
    syncSpritesToBoard(second);
    setNextDropLane(upcoming);
    setSelectedLane(null);
    setGameState("playing");
    setPhase("select");
    setTurn(1);
    setMessage("ゲーム開始！移動元を選んでください。");
    setShowEndOverlay(false);
  };

  useEffect(() => {
    initGame();
  }, []);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const gap = 16;
      const laneWidth = (rect.width - gap * (LANE_COUNT - 1)) / LANE_COUNT;
      setMetrics({
        laneWidth,
        gap,
        slotHeight: 96,
        height: rect.height,
        paddingBottom: 24,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (gameState !== "playing") return;
    const forced = detectForcedLoss(board, nextDropLane);
    if (forced) {
      setGameState("lost");
      setPhase("end");
      setShowEndOverlay(true);
      setMessage(forced);
    }
  }, [board, nextDropLane, gameState]);

  const processEvents = async (events: AnimEvent[], finalBoard: Lane[], finalMessage: string) => {
    setPhase("animating");
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.type === "move") {
        const batch: MoveEvent[] = [];
        while (i < events.length && events[i].type === "move") {
          batch.push(events[i] as MoveEvent);
          i += 1;
        }
        setSprites((prev) => {
          const next = { ...prev };
          batch.forEach((m) => {
            next[m.id] = { ...next[m.id], lane: m.toLane, index: m.toIndex };
          });
          return next;
        });
        const maxDur = Math.max(...batch.map((b) => b.duration));
        await new Promise((r) => setTimeout(r, maxDur));
        continue;
      }
      if (ev.type === "drop") {
        setSprites((prev) => ({
          ...prev,
          [ev.id]: {
            id: ev.id,
            size: ev.visualSize,
            linked: false,
            lane: ev.lane,
            index: ev.toIndex,
            isGhost: true,
          },
        }));
        await new Promise((r) => setTimeout(r, ev.duration));
      } else if (ev.type === "merge") {
        setSprites((prev) => ({
          ...prev,
          [ev.id]: { ...prev[ev.id], size: ev.newSize },
        }));
        await new Promise((r) => setTimeout(r, ev.duration + MERGE_FLASH_MS));
      } else if (ev.type === "link") {
        setSprites((prev) => ({
          ...prev,
          [ev.id]: { ...prev[ev.id], linked: true },
        }));
        await new Promise((r) => setTimeout(r, ev.duration + LINK_BUMP_MS));
      } else if (ev.type === "settle") {
        await new Promise((r) => setTimeout(r, ev.duration));
      } else if (ev.type === "gameOver") {
        setMessage(ev.message);
        setGameState("lost");
        setPhase("end");
        return;
      }
      i += 1;
    }
    setBoard(finalBoard);
    syncSpritesToBoard(finalBoard);
    setMessage(finalMessage);
    setPhase("select");
  };

  const handleMove = async (from: number, to: number) => {
    if (phase !== "select" || gameState !== "playing") return;
    setPhase("resolving");
    const moveResult = resolveMove(board, from, to);
    if (moveResult.events.length === 0) {
      setMessage(moveResult.message);
      setSelectedLane(null);
      setPhase("select");
      return;
    }

    await processEvents(moveResult.events, moveResult.nextBoard, moveResult.message);
    if (checkWin(moveResult.nextBoard)) {
      setGameState("won");
      setPhase("end");
      setShowEndOverlay(true);
      setMessage("勝利！5-4-3-2-1が揃いました。");
      return;
    }
    const dropResult = resolveDrop(moveResult.nextBoard, nextDropLane, nextId);
    await processEvents(dropResult.events, dropResult.nextBoard, dropResult.message);

    if (dropResult.lost) {
      setGameState("lost");
      setPhase("end");
      setShowEndOverlay(true);
      return;
    }
    if (checkWin(dropResult.nextBoard)) {
      setGameState("won");
      setPhase("end");
      setShowEndOverlay(true);
      setMessage("勝利！5-4-3-2-1が揃いました。");
      return;
    }
    const upcoming = pickNextLane(nextDropLane);
    setNextDropLane(upcoming);
    setSelectedLane(null);
    setTurn((t) => t + 1);
  };

  const handleLaneClick = (laneIdx: number) => {
    if (gameState !== "playing" || phase !== "select") return;
    if (selectedLane === null) {
      if (board[laneIdx].length === 0) {
        setMessage("空のレーンは選べません。");
        return;
      }
      setSelectedLane(laneIdx);
      setMessage(`レーン${laneIdx + 1}を選択。移動先をタップ。`);
      return;
    }
    if (selectedLane === laneIdx) {
      // skip -> only drop
      setSelectedLane(null);
      setPhase("resolving");
      (async () => {
        const dropResult = resolveDrop(board, nextDropLane, nextId);
        await processEvents(dropResult.events, dropResult.nextBoard, dropResult.message);
        if (dropResult.lost) {
          setGameState("lost");
          setPhase("end");
          setShowEndOverlay(true);
          return;
        }
        if (checkWin(dropResult.nextBoard)) {
          setGameState("won");
          setPhase("end");
          setShowEndOverlay(true);
          setMessage("勝利！5-4-3-2-1が揃いました。");
          return;
        }
        const upcoming = pickNextLane(nextDropLane);
        setNextDropLane(upcoming);
        setTurn((t) => t + 1);
        setPhase("select");
      })();
      return;
    }
    handleMove(selectedLane, laneIdx);
  };

  const renderCups = Object.values(sprites);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">CUP STACK EX</h1>
            <p className="text-sm text-cyan-200">
              状態: {gameState} / フェーズ: {phase} / ターン: {turn}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-800 px-3 py-2 text-sm">
              次の落下: {nextDropLane + 1}
            </span>
            <button
              type="button"
              onClick={initGame}
              className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              リセット
            </button>
          </div>
        </header>

        <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg">
            <div className="relative h-[600px]">
            {/* lane backgrounds */}
            <div ref={boardRef} className="absolute inset-0 grid grid-cols-4 gap-4">
              {Array.from({ length: LANE_COUNT }).map((_, laneIdx) => (
                <div
                  key={`lane-bg-${laneIdx}`}
                  className={`relative rounded-xl border border-slate-800/70 bg-slate-900/60 ${
                    nextDropLane === laneIdx ? "animate-pulse ring-2 ring-rose-400/60" : ""
                  } ${selectedLane === laneIdx ? "ring-2 ring-cyan-300" : ""}`}
                  onClick={() => handleLaneClick(laneIdx)}
                >
                  <div className="absolute inset-3 border border-dashed border-slate-800/50 rounded-lg" />
                  <div className="absolute top-2 left-3 text-xs text-slate-400">
                    Lane {laneIdx + 1}
                  </div>
                </div>
              ))}
            </div>

            {/* cups as sprites */}
            <div className="absolute inset-0 pointer-events-none">
              <AnimatePresence>
                {renderCups.map((cup) => {
                  const pos = slotCache[`${cup.lane}-${cup.index}`] ?? { x: 0, y: 0 };
                  const color = sizeColors[cup.size] ?? "#94a3b8";
                  const scale = (cup.isGhost ? 0.98 : 1) * (1 + cup.size * 0.05);
                  const isLinkedGroup = linkedGroupIds.has(cup.id);
                  return (
                    <motion.div
                      key={cup.id}
                      initial={{ x: pos.x, y: pos.y - 60, scale }}
                      animate={{ x: pos.x, y: pos.y, scale }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="absolute pointer-events-none"
                    >
                      <svg viewBox="0 0 140 160" className="w-40 h-32">
                        <defs>
                          <linearGradient id={`body-${cup.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
                            <stop offset="100%" stopColor={color} stopOpacity="0.6" />
                          </linearGradient>
                        </defs>
                        <g>
                          {isLinkedGroup ? (
                            <>
                              <path
                                d="M18 14 L122 14 L106 142 Q70 154 34 142 Z"
                                fill="none"
                                stroke="#ffffffee"
                                strokeWidth="3"
                              />
                              <ellipse
                                cx="70"
                                cy="18"
                                rx="54"
                                ry="13"
                                fill="none"
                                stroke="#ffffffee"
                                strokeWidth="2.5"
                              />
                              <ellipse
                                cx="70"
                                cy="140"
                                rx="32"
                                ry="10"
                                fill="none"
                                stroke="#ffffffee"
                                strokeWidth="2"
                              />
                            </>
                          ) : null}
                          <ellipse
                            cx="70"
                            cy="18"
                            rx="52"
                            ry="12"
                            fill={`${color}`}
                            opacity="0.9"
                            stroke="#ffffff55"
                            strokeWidth="2"
                          />
                          <path
                            d="M22 18 L118 18 L104 140 Q70 150 36 140 Z"
                            fill={`url(#body-${cup.id})`}
                            stroke={`${color}cc`}
                            strokeWidth="3"
                          />
                          <ellipse cx="70" cy="140" rx="28" ry="10" fill={`${color}55`} />
                          <ellipse
                            cx="70"
                            cy="20"
                            rx="44"
                            ry="10"
                            fill="rgba(12,17,35,0.95)"
                            stroke="#ffffff33"
                            strokeWidth="1.5"
                          />
                          <text
                            x="70"
                            y="70"
                            fill="#ffffff"
                            fontSize="46"
                            fontWeight="900"
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {cup.size}
                          </text>
                          {cup.linked ? (
                            <text
                              x="70"
                              y="110"
                              fill="#fbbf24"
                              fontSize="14"
                              fontWeight="800"
                              textAnchor="middle"
                            >
                              LOCK
                            </text>
                          ) : null}
                        </g>
                      </svg>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-sm text-slate-200">{message}</p>
        </section>
      </div>

      {gameState === "lost" && showEndOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl border border-rose-400/50 bg-slate-900/95 px-8 py-10 text-center shadow-2xl">
            <p className="text-sm uppercase tracking-[0.25em] text-rose-200">Game Over</p>
            <p className="mt-3 text-xl font-semibold text-rose-100">
              {message || "次の落下ができません。"}
            </p>
            <button
              type="button"
              onClick={() => setShowEndOverlay(false)}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-800 px-5 py-2 text-sm font-semibold text-rose-100 shadow-lg transition hover:bg-slate-700"
            >
              閉じる
            </button>
            <div className="mt-2 text-xs text-slate-400">
              再挑戦は右上のリセットで行ってください。
            </div>
          </div>
        </div>
      ) : null}

      {gameState === "won" && showEndOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl border border-emerald-400/50 bg-slate-900/95 px-8 py-10 text-center shadow-2xl">
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-200">Victory</p>
            <p className="mt-3 text-xl font-semibold text-emerald-100">
              5-4-3-2-1 が揃いました！
            </p>
            <button
              type="button"
              onClick={() => setShowEndOverlay(false)}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-800 px-5 py-2 text-sm font-semibold text-emerald-100 shadow-lg transition hover:bg-slate-700"
            >
              閉じる
            </button>
            <div className="mt-2 text-xs text-slate-400">
              さらに遊ぶには右上のリセットで新しいゲームを開始してください。
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default App;
