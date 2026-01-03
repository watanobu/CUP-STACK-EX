# CUP STACK EX (React + TypeScript + Vite)

4レーンのスタックパズル「CUP STACK EX」のVite/React実装です。マウス/タップ操作、連結ルール、合体/落下/勝利・敗北判定を備え、演出はイベント駆動＋Framer Motionで再生します。

## セットアップ
```bash
npm install
npm run dev   # http://localhost:5173/
npm run build # 本番ビルド
```

## 遊び方
- 4レーン、各高さ6。カップサイズ1〜5。
- 1タップ目で移動元レーン（空は不可）、2タップ目で移動先。 同じレーンを2回でスキップ。
- 移動後に予告レーンへ必ずサイズ1が落下。
- 勝利: いずれかのレーンに [5,4,3,2,1] が連続し、4,3,2,1 が連結状態。
- 敗北: 高さオーバー、ロックされた1の上に1を落とす、または詰み判定。

### 連結・移動・合体
- 下-上のサイズ差が1で上が連結（linked=true）となり、移動時は連結チェーンをまとめて移動。
- 大→小の上には置けない。連結グループは同サイズ合体不可。
- ロックされたカップとの合体は禁止。
- 落下: 1+1 は合体して2、トップがロック1なら落下不可で敗北。

## 実装メモ
- フェーズ制: `select → resolving → animating → end`
- 純関数: `resolveMove(board, action) -> { nextBoard, events[] }` / `resolveDrop(board, lane) -> { nextBoard, events[] }`
- イベントキュー: move / merge / drop / settle / link / gameOver を逐次再生し、完了後に盤面を確定反映。
- 描画: カップはレーン子DOMではなくスプライト座標を持つ絶対配置。Framer Motionで `x/y/scale` を明示アニメーション。
- アニメ時間（固定）: move 180ms / merge 140ms+flash / drop 220ms+着地120ms / link 120ms+80ms。
- RNG: シード付き（起動時 Date.now シード）。`pickNextLane` で再現性のある乱択。
- 強制敗北: 次落下レーンが高さ上限、またはロック1トップで他の合法移動でも回避不能な場合に即敗北。
- ロック表示: カップ形状に沿った白実線枠＋LOCKラベル。連結チェーン全体に適用。

## ファイル
- `src/App.tsx` ゲーム本体（フェーズ管理、イベント駆動、描画）
- `src/types.ts` 型定義
- `tailwind.config.ts` / `postcss.config.cjs` / `vite.config.ts` などビルド設定

## 今後のタスク例
- カップ形状のリッチ化・質感向上
- サウンド/画面シェイク演出の追加
- PWA対応（manifest, SW）
- テスト整備（純関数のユニットテスト）
