import { useEffect, useRef, useState } from "react";
import { Cup, GameState, Lane } from "./types";

const LANE_COUNT = 4;
const MAX_STACK_HEIGHT = 6;
const DROP_DELAY_MS = 500;

type DropResult = {
  lanes: Lane[];
  lost: boolean;
  message: string;
};

const sizeColors: Record<number, string> = {
  1: "#fb7185",
  2: "#38bdf8",
  3: "#34d399",
  4: "#fbbf24",
  5: "#a78bfa",
};

const sizeNames: Record<number, string> = {
  1: "Rose",
  2: "Sky",
  3: "Emerald",
  4: "Amber",
  5: "Violet",
};

const widthForSize = (size: number) => `${52 + size * 12}%`;

const sizeGradients: Record<number, [string, string]> = {
  1: ["#fb7185", "#f472b6"],
  2: ["#38bdf8", "#60a5fa"],
  3: ["#34d399", "#2dd4bf"],
  4: ["#fbbf24", "#fb923c"],
  5: ["#a78bfa", "#c084fc"],
};

const liquidGradient = (size: number) => {
  const [from, to] = sizeGradients[size] ?? ["#94a3b8", "#cbd5e1"];
  return `linear-gradient(135deg, ${from}, ${to})`;
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
    lane.push({ id: createId(), size: 1, linked: false });
    return {
      lanes: updated,
      lost: false,
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
    lane.push({ id: createId(), size: 1, linked: shouldLink });
    const overHeight = lane.length > MAX_STACK_HEIGHT;
    return {
      lanes: updated,
      lost: overHeight,
      message: `レーン${laneIndex + 1}に1が中に入りました。`,
    };
  }

  if (dropTop.size === 1) {
    lane.pop();
    const below = lane[lane.length - 1];
    const newCup: Cup = {
      id: createId(),
      size: 2,
      linked: below ? below.size - 2 === 1 : false,
    };
    lane.push(newCup);
    const overHeight = lane.length > MAX_STACK_HEIGHT;
    return {
      lanes: updated,
      lost: overHeight,
      message: `レーン${laneIndex + 1}で1と1が合体し2になりました。`,
    };
  }

  const shouldLink = dropTop.size === 2;
  lane.push({ id: createId(), size: 1, linked: shouldLink });
  const overHeight = lane.length > MAX_STACK_HEIGHT;
  return {
    lanes: updated,
    lost: overHeight,
    message: `レーン${laneIndex + 1}に1が中に入りました。`,
  };
};

const CupView = ({ cup, isActive }: { cup: Cup; isActive: boolean }) => {
  const liquid = liquidGradient(cup.size);
  const accent = sizeColors[cup.size] ?? "#94a3b8";
  const width = widthForSize(cup.size);
  const bodyGradientId = `cup-body-${cup.id}`;
  const liquidId = `cup-liquid-${cup.id}`;
  const clipId = `cup-clip-${cup.id}`;
  const scale = 0.88 + cup.size * 0.07;
  const height = 72 + cup.size * 10;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width }}
    >
      <svg
        viewBox="0 0 140 150"
        className={`transition-transform duration-150 drop-shadow-xl ${
          isActive ? "cup-active" : ""
        }`}
        style={{
          filter: `drop-shadow(0 12px 24px ${accent}30)`,
          height: `${height}px`,
          transform: `scale(${scale})`,
        }}
      >
        <defs>
          <linearGradient id={bodyGradientId} x1="0%" y1="0%" x2="100%" y2="120%">
            <stop offset="0%" stopColor={`${accent}`} stopOpacity="0.9" />
            <stop offset="60%" stopColor={`${accent}`} stopOpacity="0.55" />
            <stop offset="100%" stopColor={`${accent}`} stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={liquidId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.12" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipId}>
            <path d="M24 14 L116 14 L102 130 L38 130 Z" />
          </clipPath>
        </defs>

        <g transform="translate(0,4)">
          <path
            d="M20 6 L120 6 L104 134 Q70 144 36 134 Z"
            fill="#0b1225"
            stroke={`${accent}50`}
            strokeWidth="3"
          />
          <path
            d="M24 10 L116 10 L102 128 L38 128 Z"
            fill={`url(#${bodyGradientId})`}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
          />
          <ellipse
            cx="70"
            cy="12"
            rx="52"
            ry="12"
            fill="rgba(255,255,255,0.42)"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="2"
          />
          <ellipse
            cx="70"
            cy="16"
            rx="44"
            ry="9"
            fill="rgba(10, 12, 26, 0.92)"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
          />
        </g>
        <rect
          x="28"
          y="58"
          width="84"
          height="74"
          fill={liquid}
          clipPath={`url(#${clipId})`}
          stroke={`${accent}55`}
          strokeWidth="1.2"
        />
        <rect
          x="28"
          y="58"
          width="84"
          height="74"
          fill={`url(#${liquidId})`}
          clipPath={`url(#${clipId})`}
        />
        <ellipse cx="70" cy="142" rx="26" ry="9" fill="rgba(0,0,0,0.55)" />
        <ellipse
          cx="70"
          cy="137"
          rx="30"
          ry="7.5"
          fill="rgba(255,255,255,0.16)"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="2"
        />
        <text
          x="20"
          y="38"
          fill="#e2e8f0"
          fontSize="12"
          fontWeight="700"
          letterSpacing="0.12em"
        >
          {sizeNames[cup.size].toUpperCase()}
        </text>
        <text
          x="20"
          y="56"
          fill="#e2e8f0"
          fontSize="11"
          fontWeight="600"
          opacity="0.7"
        >
          SIZE {cup.size}
        </text>
        {cup.linked ? (
          <g transform="translate(92,34)">
            <rect
              x="0"
              y="-12"
              width="42"
              height="20"
              rx="10"
              fill="rgba(255,255,255,0.15)"
              stroke="#f97316"
              strokeWidth="1.6"
            />
            <text
              x="10"
              y="2"
              fill="#f97316"
              fontSize="11"
              fontWeight="800"
            >
              LOCK
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};

const LaneColumn = ({
  lane,
  index,
  nextDropLane,
  selectedLane,
  onClick,
}: {
  lane: Lane;
  index: number;
  nextDropLane: number;
  selectedLane: number | null;
  onClick: (laneIndex: number) => void;
}) => {
  const isDanger = nextDropLane === index;
  const isSelected = selectedLane === index;
  const movingStart = isSelected ? getMovingGroupStartIndex(lane) : -1;

  return (
    <button
      type="button"
      onClick={() => onClick(index)}
      className={`relative flex flex-col rounded-2xl border border-slate-700/60 px-3 pt-3 transition focus:outline-none lane-surface ${
        isSelected ? "ring-4 ring-cyan-300/80" : "hover:ring-2 hover:ring-cyan-200/70"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>Lane {index + 1}</span>
        {isDanger ? (
          <span className="lane-highlight font-semibold text-rose-300">
            ▼ DROP
          </span>
        ) : (
          <span className="text-slate-500">safe</span>
        )}
      </div>
      <div className="mt-2 flex h-[520px] flex-col-reverse items-center gap-0">
        {lane.map((cup, cupIndex) => {
          const isActive = isSelected && cupIndex >= movingStart;
          const overlap = cupIndex === 0 ? 0 : -26;
          return (
            <div
              key={cup.id}
              style={{ marginTop: overlap }}
              className="flex w-full justify-center"
            >
              <CupView cup={cup} isActive={!!isActive} />
            </div>
          );
        })}
        {Array.from({
          length: Math.max(0, MAX_STACK_HEIGHT - lane.length),
        }).map((_, i) => (
          <div
            key={`ghost-${index}-${i}`}
            className="h-20 w-full rounded-lg border border-dashed border-slate-700/60 bg-slate-900/20"
          />
        ))}
        <div className="pointer-events-none lane-grid absolute inset-2 rounded-xl" />
      </div>
    </button>
  );
};

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

  const idRef = useRef(1);

  const nextId = () => {
    const id = idRef.current;
    idRef.current += 1;
    return `cup-${id}`;
  };

  useEffect(() => {
    initGame();
  }, []);

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
      setLanes((current) => {
        const dropResult = applyDropToLanes(current, nextDropLane, nextId);
        const updated = dropResult.lanes;

        if (dropResult.lost) {
          setGameState("lost");
          setMessage(dropResult.message);
          setIsDropping(false);
          return updated;
        }

        if (checkWin(updated)) {
          setGameState("won");
          setMessage("勝利！5-4-3-2-1が揃いました。");
          setIsDropping(false);
          return updated;
        }

        const upcoming = pickNextLane(nextDropLane);

        setNextDropLane(upcoming);
        setTurn((t) => t + 1);
        setMessage(dropResult.message);
        setIsDropping(false);
        return updated;
      });
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
              <LaneColumn
                key={`lane-${idx}`}
                lane={lane}
                index={idx}
                nextDropLane={nextDropLane}
                selectedLane={selectedLane}
                onClick={handleLaneClick}
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
    </div>
  );
};

export default App;
