---
description: 查詢今天 NBA 某場比賽的 box score（球員個人數據）
context: fork
agent: general-purpose
argument-hint: "[team-abbr|eventId]"
allowed-tools: Bash
---

# 任務：查詢今天 NBA box score

使用者輸入：`$ARGUMENTS`（可能為空、team abbreviation 如 LAL、或 eventId 如 401871160）。

依序執行：

## 1. 取得今天場次

跑 Bash：`nba-games`，把 stdout 當 JSON 解析，拿到 `games` 陣列。

- 若 `games` 是空陣列 → 回答「今天沒有 NBA 比賽」並結束。
- 若有 `error` 欄位 → 回答「無法取得 NBA 賽程：{error}」並結束。

## 2. 找出目標場次 id

依 `$ARGUMENTS` 解析：

- **純數字**（≥ 4 位）→ 視為 eventId，從 `games` 找 `id` 完全相符。
- **字母**（≤ 4 字）→ 視為 team abbreviation，找 `home` 或 `away` 不分大小寫完全相符的場次。
- **空字串** → 自動挑：先取 `state === 'in'` 第一場、否則 `pre` 開賽時間最近的、否則 `post` 開賽時間最近的。

找不到對應場次 → 回答「找不到 "{ARGUMENTS}" 對應的場次。今天場次：」+ 列出每場 `{away} {awayScore} - {homeScore} {home} ({state})` 並結束。

## 3. 跑 box score

從找到的 game 物件取 `id`，跑 Bash：`nba-box {id}`

- 若 exit 非 0：把 stderr 訊息直接回報給使用者並結束。

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

兩個區塊之間加一個空行。表格前後不要寫額外解釋（保持簡潔），除非使用者後續追問。
