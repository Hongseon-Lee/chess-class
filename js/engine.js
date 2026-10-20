// 일부러 약하게 만든 체스 엔진.
//
// 읽는 깊이(1~3수)로만 약해진다. 무작위로 나쁜 수를 섞지 않고, 같은 판에서는 언제나
// 같은 수를 둔다. 수의 합법성은 전부 chess.js가 정한다. 다만 빠르기 위해 chess.js의
// 내부 함수(CORE)를 쓴다. 공개 함수만 쓰면 깊이 3이 아이폰에서 2초쯤 걸린다.
// chess.js를 바꾸면 tests의 coreSelfCheck와 tools/test_play.py --full로 다시 확인한다.
//
// 이 파일은 글을 쓰지 않는다. 엔진이 둔 수를 설명하는 문장은 explain.js가 만든다.
import { Chess } from './vendor/chess.js'

export const MATE = 100000
export const DEFAULT_NODE_BUDGET = 8000

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

// 칸이 판 가운데에 얼마나 가까운가(0~6). 나이트, 비숍, 폰에만 가산점을 준다.
const CENTRE = new Array(128).fill(0)
for (let sq = 0; sq < 128; sq++) {
  if (sq & 0x88) continue
  CENTRE[sq] = Math.round(7 - Math.abs((sq & 7) - 3.5) - Math.abs((sq >> 4) - 3.5))
}
const CENTRE_WEIGHT = { n: 5, b: 3, p: 2, r: 0, q: 0, k: 0 }

const CORE = ['_moves', '_makeMove', '_undoMove', '_attacked', '_isKingAttacked', '_board', '_turn', '_kings', '_hash', '_halfMoves', '_positionCount']

function assertCore(chess) {
  for (const name of CORE) {
    if (!(name in chess)) throw new Error(`엔진이 쓰는 chess.js 내부 기능이 없습니다: ${name}`)
  }
}

function square(sq) {
  return 'abcdefgh'[sq & 7] + (8 - (sq >> 4))
}

function other(color) {
  return color === 'w' ? 'b' : 'w'
}

// 엔진이 고를 수 있는 수. 승격은 퀸으로만 한다(레슨의 "이 앱에서는 자동으로 퀸이 됩니다"와 맞춘다).
function legalMoves(chess) {
  return chess._moves({ legal: true }).filter((m) => !m.promotion || m.promotion === 'q')
}

// 한쪽에 킹만 남았을 때, 이긴 쪽이 상대 킹을 가장자리로 몰고 자기 킹을 붙이고 상대 킹이 갈 칸을
// 줄이게 하는 점수(46 이하). 없으면 이긴 끝내기를 마무리하지 못하고 맴돌다 50수 무승부가 된다.
// moves는 둘 차례인 쪽의 합법 수다. 지는 쪽 차례일 때만 그 킹이 갈 칸 수로 쓴다.
function mopUp(chess, stm, moves) {
  const board = chess._board
  const count = { w: 0, b: 0 }
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const p = board[sq]
    if (p && p.type !== 'k') count[p.color]++
  }
  let winner = null
  if (count.w > 0 && count.b === 0) winner = 'w'
  if (count.b > 0 && count.w === 0) winner = 'b'
  if (!winner) return 0
  const lone = chess._kings[other(winner)]
  const mine = chess._kings[winner]
  const edge = 6 - CENTRE[lone]
  const apart = Math.max(Math.abs((lone & 7) - (mine & 7)), Math.abs((lone >> 4) - (mine >> 4)))
  const boxed = stm === winner ? 0 : 8 - Math.min(8, moves.length)
  const bonus = 3 * edge + 2 * (7 - apart) + 2 * boxed
  return winner === stm ? bonus : -bonus
}

// 둘 차례인 쪽에서 본 점수. moves는 이 판에서 둘 차례인 쪽의 합법 수.
function evaluate(chess, moves) {
  const board = chess._board
  const stm = chess._turn
  const opp = other(stm)
  let score = 0
  const mine = []
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const p = board[sq]
    if (!p) continue
    const v = VALUE[p.type] + CENTRE_WEIGHT[p.type] * CENTRE[sq]
    score += p.color === stm ? v : -v
    if (p.color === stm && p.type !== 'k') mine.push(sq)
  }

  // 지금 잡을 수 있는 것 가운데 가장 큰 이득. 상대가 그 칸을 지키면 잡은 기물을 내줄 셈으로 친다.
  const cheapest = new Map()
  for (const m of moves) {
    if (!m.captured || (m.flags & 8)) continue // 앙파상은 잡히는 폰이 도착 칸에 없다
    const a = VALUE[m.piece] || 10000
    if (!cheapest.has(m.to) || a < cheapest.get(m.to)) cheapest.set(m.to, a)
  }
  let gain = 0
  for (const [to, a] of cheapest) {
    const victim = VALUE[board[to].type]
    const g = chess._attacked(opp, to) ? Math.max(0, victim - a) : victim
    if (g > gain) gain = g
  }

  // 상대가 노리는 내 기물. 둘 차례이므로 가장 큰 것 하나는 피할 수 있다고 보고 두 번째를 뺀다.
  // 체크 중이면 피할 틈이 없으므로 가장 큰 것을 뺀다.
  let first = 0
  let second = 0
  for (const sq of mine) {
    if (!chess._attacked(opp, sq)) continue
    const victim = VALUE[board[sq].type]
    let loss = victim
    if (chess._attacked(stm, sq)) {
      let low = 10000
      for (const a of chess._attacked(opp, sq, true)) low = Math.min(low, VALUE[chess.get(a).type] || 10000)
      loss = Math.max(0, victim - low)
    }
    if (loss > first) { second = first; first = loss } else if (loss > second) second = loss
  }
  const inCheck = chess._isKingAttacked(stm)
  return score + gain - (inCheck ? first : second) + mopUp(chess, stm, moves)
}

function search(chess, depth, nodeBudget) {
  let nodes = 0
  let killers = []
  const path = []
  const ABORT = {}
  let current = 0

  const same = (a, b) => a && b && a.from === b.from && a.to === b.to && a.promotion === b.promotion

  function orderKey(m, ply) {
    if (m.captured) return 10000 + VALUE[m.captured] * 10 - VALUE[m.piece]
    if (m.promotion) return 9000 + VALUE[m.promotion]
    const k = killers[ply]
    if (k && same(k[0], m)) return 8000
    if (k && same(k[1], m)) return 7999
    return 0
  }

  function ordered(moves, ply) {
    return moves
      .map((m, i) => [orderKey(m, ply), i, m])
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .map((x) => x[2])
  }

  // 이미 나왔던 판으로 돌아가는 수는 무승부(0점)로 친다. 실제 대국에서 나온 횟수(chess.js의 셈)에
  // 찾는 길 위의 횟수를 더해 두 번째면 그렇게 본다. 세 번째에야 무승부로 치면, 이기고 있는 엔진이
  // 같은 자리를 오가는 사이 지는 쪽이 세 번 되풀이로 비겨 버린다(깊이 1의 퀸과 킹 끝내기에서 확인).
  // 실제로 대국을 끝내는 판정은 언제나 chess.js의 세 번 되풀이다.
  function repeated() {
    const h = chess._hash
    let c = chess._positionCount.get(h) || 0
    for (let i = 0; i < path.length; i++) if (path[i] === h) c++
    return c >= 2
  }

  function negamax(left, alpha, beta, ply) {
    nodes++
    const moves = legalMoves(chess)
    if (moves.length === 0) return chess._isKingAttacked(chess._turn) ? -(MATE - ply) : 0
    if (chess._halfMoves >= 100 || repeated() || chess.isInsufficientMaterial()) return 0
    if (left === 0) return evaluate(chess, moves)
    let best = -Infinity
    for (const m of ordered(moves, ply)) {
      chess._makeMove(m)
      path.push(chess._hash)
      let s
      try {
        s = -negamax(left - 1, -beta, -alpha, ply + 1)
      } finally {
        path.pop()
        chess._undoMove()
      }
      if (s > best) best = s
      if (s > alpha) alpha = s
      if (alpha >= beta) {
        if (!m.captured && !m.promotion) {
          const k = killers[ply] || (killers[ply] = [null, null])
          if (!same(k[0], m)) { k[1] = k[0]; k[0] = m }
        }
        break
      }
    }
    if (current > 1 && nodes > nodeBudget) throw ABORT
    return best
  }

  let rootMoves = ordered(legalMoves(chess), 0)
  let result = null
  for (let d = 1; d <= depth; d++) {
    current = d
    const scored = []
    let best = null
    let bestScore = -Infinity
    try {
      for (const m of rootMoves) {
        chess._makeMove(m)
        path.push(chess._hash)
        let s
        try {
          s = -negamax(d - 1, -Infinity, -bestScore, 1)
        } finally {
          path.pop()
          chess._undoMove()
        }
        scored.push([s, scored.length, m])
        if (s > bestScore) { best = m; bestScore = s }
      }
    } catch (e) {
      if (e === ABORT && result) break
      throw e
    }
    result = { move: best, score: bestScore, depthReached: d }
    rootMoves = scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[2])
  }
  return { ...result, nodes }
}

// 대국의 시작 판과 지금까지의 수(UCI)로 판을 다시 만든다. 공개 함수로 두므로 되풀이 셈이 실제 대국과 같다.
function replay(startFen, moves) {
  const chess = new Chess(startFen)
  for (const uci of moves) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined })
    } catch (e) {
      throw new Error(`둘 수 없는 수입니다: ${uci}`) // chess.js는 둘 수 없는 수에 영어 예외를 던진다
    }
  }
  return chess
}

// depth: 1(입문), 2(초급), 3(중급). 대국이 이미 끝났으면 null.
// 돌려주는 수는 {from, to, promotion}. promotion은 승격일 때만 'q'.
export function chooseMove({ startFen, moves = [], depth, nodeBudget = DEFAULT_NODE_BUDGET }) {
  if (![1, 2, 3].includes(depth)) throw new Error(`깊이는 1, 2, 3 가운데 하나여야 합니다: ${depth}`)
  const chess = replay(startFen, moves)
  assertCore(chess)
  if (chess.isGameOver()) return null
  const r = search(chess, depth, nodeBudget)
  return {
    from: square(r.move.from),
    to: square(r.move.to),
    promotion: r.move.promotion || undefined,
    score: r.score,
    depthReached: r.depthReached,
    nodes: r.nodes,
  }
}

// 테스트용: 둘 차례인 쪽에서 본 이 판의 점수.
export function evaluateFen(fen) {
  const chess = new Chess(fen)
  assertCore(chess)
  return evaluate(chess, legalMoves(chess))
}

// 테스트용: 내부 함수로 만든 합법 수와 공개 함수의 합법 수가 같은지, 내부 함수로 둔 판이
// 공개 함수로 둔 판과 같은지 본다.
export function coreSelfCheck(fen) {
  const chess = new Chess(fen)
  assertCore(chess)
  const name = (m) => square(m.from) + square(m.to) + (m.promotion || '')
  const publicMoves = chess.moves({ verbose: true }).map((m) => m.lan).sort()
  const coreMoves = chess._moves({ legal: true }).map(name).sort()
  let fensMatch = true
  for (const m of chess._moves({ legal: true })) {
    chess._makeMove(m)
    const viaCore = chess.fen()
    chess._undoMove()
    const check = new Chess(fen)
    check.move({ from: square(m.from), to: square(m.to), promotion: m.promotion })
    if (check.fen() !== viaCore) fensMatch = false
  }
  return { publicMoves, coreMoves, fensMatch, unchanged: chess.fen() === new Chess(fen).fen() }
}
