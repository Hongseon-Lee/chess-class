// 외통 퍼즐 문제 하나를 푸는 상태. 화면과 시간은 모른다(puzzle-view.js가 맡는다).
//
// Lichess 규약: puzzle.fen은 상대가 수를 두기 직전의 판이고 moves[0]이 상대의 수다. 문제의 판은 그 수를
// 둔 뒤이고 정답은 moves[1]부터다. 정답은 퍼즐이 정한 수가 아니라 "외통인가"로 판정한다(mate.js).
//
// 흐름:
//   start()                         상대의 첫 수를 둔다
//   userMove({from, to})            → {kind: 'mate' | 'wrong' | 'forcing' | 'refuted', move, why?}
//     'wrong'   외통이 아니다. 판에는 그 수가 놓여 있다. takeBack()으로 되돌린다
//     'forcing' 2수 외통의 맞는 첫 수. reply()로 상대의 막는 수를 둔다
//     'refuted' 2수 외통의 틀린 첫 수. playRefutation()으로 막는 수를 두고, retry()로 처음 자리로
//   revealStep()                    정답 수순을 한 수씩 둔다(틀린 횟수가 2 이상일 때)
import { Chess } from './vendor/chess.js'
import { matingMoves, refutation, everyReplyAllowsMate, whyNotMate, replyMoves } from './mate.js'

export const REVEAL_AFTER = 2 // 이만큼 틀리면 정답을 볼 수 있다

function uciOf(m) {
  return m.from + m.to + (m.promotion || '')
}

function asMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }
}

// theme: 'mateIn1' | 'mateIn2'
export function createPuzzleSession(puzzle, theme) {
  if (theme !== 'mateIn1' && theme !== 'mateIn2') throw new Error(`모르는 퍼즐 테마입니다: ${theme}`)
  const game = new Chess(puzzle.fen)
  const userColor = game.turn() === 'w' ? 'b' : 'w' // 상대가 먼저 한 수를 둔다
  let stage = 'opening' // 'opening' | 'solving' | 'wrong' | 'refuting' | 'refuted' | 'replying' | 'solved' | 'revealed'
  let phase = 1 // 2수 외통에서 맞는 첫 수와 상대의 막는 수 뒤면 2
  let wrong = 0
  let pendingReply = null
  let firstMove = null // 2수 외통에서 둔 맞는 첫 수
  const revealQueue = []

  function start() {
    if (stage !== 'opening') throw new Error('이미 시작한 문제입니다')
    stage = 'solving'
    return game.move(asMove(puzzle.moves[0]))
  }

  function userMove({ from, to }) {
    if (stage !== 'solving' || game.turn() !== userColor) return null
    let move
    try {
      move = game.move({ from, to, promotion: 'q' })
    } catch (e) {
      return null
    }
    if (game.isCheckmate()) {
      stage = 'solved'
      return { kind: 'mate', move }
    }
    if (theme === 'mateIn2' && phase === 1 && !game.isGameOver()) {
      if (everyReplyAllowsMate(game)) {
        firstMove = move
        stage = 'replying'
        return { kind: 'forcing', move }
      }
      wrong++
      pendingReply = refutation(game)
      stage = 'refuting'
      return { kind: 'refuted', move }
    }
    wrong++
    stage = 'wrong'
    return { kind: 'wrong', move, why: whyNotMate(game, move) }
  }

  // 'wrong' 뒤: 그 수를 되돌린다.
  function takeBack() {
    if (stage !== 'wrong') throw new Error('되돌릴 틀린 수가 없습니다')
    game.undo()
    stage = 'solving'
  }

  // 'forcing' 뒤: 상대의 막는 수. 내 첫 수가 Lichess의 정답과 같으면 Lichess의 수, 아니면 replyMoves의 처음.
  // 어느 쪽이든 다음 수에 외통이 있다(everyReplyAllowsMate).
  function reply() {
    if (stage !== 'replying') throw new Error('상대가 둘 차례가 아닙니다')
    const lichess = uciOf(firstMove) === puzzle.moves[1] ? asMove(puzzle.moves[2]) : null
    const next = lichess || replyMoves(game)[0]
    const move = game.move({ from: next.from, to: next.to, promotion: next.promotion })
    phase = 2
    stage = 'solving'
    return move
  }

  // 'refuted' 뒤: 다음 수에 외통이 없게 막는 수를 둔다.
  function playRefutation() {
    if (stage !== 'refuting') throw new Error('막는 수를 둘 차례가 아닙니다')
    const move = game.move({ from: pendingReply.from, to: pendingReply.to, promotion: pendingReply.promotion })
    pendingReply = null
    stage = 'refuted'
    return move
  }

  // 막는 수를 보여 준 뒤: 문제의 처음 자리(상대의 첫 수를 둔 뒤)로.
  function retry() {
    if (stage !== 'refuted') throw new Error('다시 해 볼 차례가 아닙니다')
    game.undo()
    game.undo()
    stage = 'solving'
  }

  function canReveal() {
    return stage === 'solving' && wrong >= REVEAL_AFTER
  }

  // 정답 수순을 한 수씩 둔다. 처음 부르면 남은 수순을 정하고, 다 두면 null.
  // 첫 수 차례면 Lichess의 수순을, 2수 외통의 둘째 수 차례면 지금 판에서 외통인 수(Lichess의 넷째 수가 맞으면 그것)를 둔다.
  function revealStep() {
    if (stage === 'solving') {
      if (!canReveal()) throw new Error('아직 정답을 볼 수 없습니다')
      stage = 'revealed'
      if (phase === 1) {
        revealQueue.push(...puzzle.moves.slice(1).map(asMove))
      } else {
        const mates = matingMoves(game)
        const lichess = mates.find((m) => uciOf(m) === puzzle.moves[3])
        revealQueue.push(lichess || mates[0])
      }
    }
    if (stage !== 'revealed') throw new Error('정답을 보는 중이 아닙니다')
    const next = revealQueue.shift()
    return next ? game.move({ from: next.from, to: next.to, promotion: next.promotion }) : null
  }

  return {
    game,
    puzzle,
    theme,
    userColor,
    start,
    userMove,
    takeBack,
    reply,
    playRefutation,
    retry,
    canReveal,
    revealStep,
    stage: () => stage,
    phase: () => phase,
    wrongCount: () => wrong,
    // 정답 보기 없이 내가 외통을 만들었는가
    solved: () => stage === 'solved',
    // 이 문제를 끝냈는가(풀었든 정답을 다 보았든)
    finished: () => stage === 'solved' || (stage === 'revealed' && revealQueue.length === 0 && game.isCheckmate()),
  }
}
