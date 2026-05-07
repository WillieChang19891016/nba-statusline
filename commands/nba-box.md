---
description: 查詢今天 NBA 某場比賽的 box score（球員個人數據）
---

# 任務：查詢今天的 NBA box score

依序執行：

## 1. 取得今天的場次

跑 Bash：`nba-games`

把 stdout 當 JSON 解析。

- 如果 `games` 是空陣列 → 回答「今天沒有 NBA 比賽」結束。
- 如果有 `error` 欄位 → 回答「無法取得 NBA 賽程：{error}」結束。

## 2. 讓使用者選場次

排序：state === `in`（live）→ `pre`（未開賽）→ `post`（已結束）；同類別內維持 nba-games 原順序。

如果**只有 1 場**：跳過此步驟，直接用該場 `id` 進入第 3 步。

如果**有 2 場以上**：用 AskUserQuestion 列出最多 4 場（live 優先 → pre → post 截斷）：

- option label 格式：
  - `state === 'in'` → `🔴 {away} {awayScore} - {homeScore} {home}`（例：`🔴 MIN 95 - 133 SA`）
  - `state === 'post'` → `{away} {awayScore} - {homeScore} {home}`
  - `state === 'pre'` → `{away} @ {home}`
- option description 寫 `{shortDetail} · ID {id}`（如 `Final · ID 401871153` 或 `Q4 2:30 · ID 401871160`）

## 3. 跑 box score

從使用者選的 label 找回對應 `id`，跑 Bash：`nba-box {id}`

如果 exit 非 0：把 stderr 訊息直接回報使用者並結束。

## 4. 把 stdout 轉 markdown

`nba-box` stdout 結構：兩個區塊用空白行分隔，每個區塊：

```
<隊名> · <總分>
PLAYER <padding>  MIN  PTS  FG    3PT  FT    REB  AST  STL  BLK  +/-
<player rows>
DNP: <names>          (optional last line)
```

對每個區塊產出：

- `### {隊名} · {總分}`
- 11 欄 markdown table（PLAYER / MIN / PTS / FG / 3PT / FT / REB / AST / STL / BLK / +/-）
- 若有 `DNP:` 行 → 表格下方加 `*DNP: ...*`

兩個區塊之間加一個空行。表格前後不要再寫額外解釋（保持簡潔），除非使用者後續追問。
