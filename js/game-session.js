// 엔진과 두는 대국 한 판.
//
// 살아 있는 Chess 하나에 수를 공개 함수 move()로만 둔다. FEN만으로 판을 다시 만들지 않으므로
// 세 번 되풀이와 50수 규칙의 셈이 실제 대국과 같다. 결과는 저장하지 않고 언제나 chess.js로
// 계산한다. 기권만 따로 남긴다. 화면과 엔진은 모른다(play-view.js가 둘을 잇는다).
//
// 둔 수는 따로 목록(played)에 들고 있는다. chess.js의 history({verbose: true})는 부를 때마다
// 모든 수의 SAN과 FEN을 다시 만들어서, 200수짜리 대국에서 한 번에 9ms쯤 걸린다(맥 Chrome).
import { Chess } from './vendor/chess.js'

function other(color) {
  return color === 'w' ? 'b' : 'w'
}

function uciOf(move) {
  return move.from + move.to + (move.promotion || '')
}

// 대국이 끝났으면 {kind, winner}, 아니면 null. 판정 순서는 explain.js와 같다.
function judge(chess, resigned, userColor) {
  if (resigned) return { kind: 'resigned', winner: other(userColor) }
  if (chess.isCheckmate()) return { kind: 'checkmate', winner: other(chess.turn()) }
  if (chess.isStalemate()) return { kind: 'stalemate', winner: null }
  if (chess.isInsufficientMaterial()) return { kind: 'insufficient', winner: null }
  if (chess.isThreefoldRepetition()) return { kind: 'repetition', winner: null }
  if (chess.isDrawByFiftyMoves()) return { kind: 'fifty', winner: null }
  return null
}

// moves: 지금까지 둔 수(UCI). 둘 수 없는 수가 있거나 끝난 대국에 수가 더 있으면 예외.
export function createGameSession({ startFen, depth, userColor, moves = [], resigned = false, reachedEnd = false }) {
  if (![1, 2, 3].includes(depth)) throw new Error(`깊이는 1, 2, 3 가운데 하나여야 합니다: ${depth}`)
  if (userColor !== 'w' && userColor !== 'b') throw new Error(`내 색은 'w' 또는 'b'여야 합니다: ${userColor}`)
  const chess = new Chess(startFen)
  const played = [] // chess.move()가 돌려준 수들. 무르면 함께 뺀다.
  for (const uci of moves) {
    if (judge(chess, false, userColor)) throw new Error(`끝난 대국에 수가 더 있습니다: ${uci}`)
    try {
      played.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }))
    } catch (e) {
      throw new Error(`둘 수 없는 수입니다: ${uci}`)
    }
  }
  if (resigned && judge(chess, false, userColor)) throw new Error('끝난 대국을 기권할 수는 없습니다')
  let ended = reachedEnd || judge(chess, resigned, userColor) !== null
  let version = 0
  const engineColor = other(userColor)

  function outcome() {
    return judge(chess, resigned, userColor)
  }

  // 'user', 'engine', 또는 끝났으면 null.
  function turn() {
    if (outcome()) return null
    return chess.turn() === userColor ? 'user' : 'engine'
  }

  function lastMove() {
    return played.length ? played[played.length - 1] : null
  }

  // 내 수가 하나라도 있고 기권하지 않았으면 무를 수 있다. 끝난 뒤에도 무를 수 있다.
  function canUndo() {
    return !resigned && played.some((m) => m.color === userColor)
  }

  function uciMoves() {
    return played.map(uciOf)
  }

  function afterMove(move) {
    played.push(move)
    if (outcome()) ended = true
    return move
  }

  return {
    startFen,
    depth,
    userColor,
    engineColor,
    game: chess,

    outcome,
    turn,
    lastMove,
    canUndo,

    // 승격은 언제나 퀸. 내 차례가 아니거나 둘 수 없는 수면 null.
    userMove({ from, to }) {
      if (turn() !== 'user') return null
      let move
      try {
        move = chess.move({ from, to, promotion: 'q' })
      } catch (e) {
        return null
      }
      return afterMove(move)
    },

    engineRequest() {
      return { startFen, moves: uciMoves(), depth }
    },

    // 엔진이 고른 수를 공개 move()로 둔다. 합법성을 여기서 한 번 더 확인한다.
    applyEngineMove({ from, to, promotion }) {
      if (turn() !== 'engine') throw new Error('엔진의 차례가 아닙니다')
      return afterMove(chess.move({ from, to, promotion }))
    },

    // 마지막 수가 엔진의 것이면 엔진의 수와 내 수를, 내 수면 그것 하나를 되돌린다.
    // 되돌린 뒤에는 언제나 내 차례다.
    undo() {
      if (!canUndo()) return false
      if (lastMove().color === engineColor) {
        chess.undo()
        played.pop()
      }
      chess.undo()
      played.pop()
      version++
      return true
    },

    resign() {
      if (outcome()) return false
      resigned = true
      ended = true
      version++
      return true
    },

    // 무르기나 기권이 있을 때마다 바뀐다. 엔진이 생각하는 사이에 바뀌었으면 그 결과를 버린다.
    version() {
      return version
    },

    // 한 번이라도 끝까지 갔는가. 무른 뒤에도 참으로 남는다.
    reachedEnd() {
      return ended
    },

    record() {
      return {
        v: 1,
        startFen,
        depth,
        userColor,
        moves: uciMoves(),
        resigned,
        reachedEnd: ended,
      }
    },
  }
}

function isRecord(r) {
  return (
    r !== null &&
    typeof r === 'object' &&
    r.v === 1 &&
    typeof r.startFen === 'string' &&
    [1, 2, 3].includes(r.depth) &&
    (r.userColor === 'w' || r.userColor === 'b') &&
    Array.isArray(r.moves) &&
    r.moves.every((m) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8]q?$/.test(m)) &&
    typeof r.resigned === 'boolean' &&
    typeof r.reachedEnd === 'boolean'
  )
}

// 저장해 둔 기록으로 대국을 되살린다. 모양이 이상하거나 수를 다시 둘 수 없으면 null.
export function restoreGameSession(record) {
  if (!isRecord(record)) return null
  try {
    return createGameSession(record)
  } catch (e) {
    return null
  }
}
