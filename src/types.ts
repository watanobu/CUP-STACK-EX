export type Cup = {
  id: string;
  size: number;
  linked: boolean;
};

export type Lane = Cup[];

export type GameState = "start" | "playing" | "won" | "lost";
