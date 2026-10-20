// 대국 화면이 판에 대해 보여 주는 모든 문장.
//
// 엔진의 속마음이 아니라 그 수가 판에서 한 일만 말한다. 사실 하나를 정해진 우선순위로 고르고,
// 그 사실은 chess.js의 공개 함수로 판정한다. 모든 문장은 tools/test_play.py가 python-chess로
// 다시 확인한다. 문장이나 판정을 고치면 그 검사를 돌린다.
//
// "노린다"는 말(노리던, 노립니다)은 합법적인 잡기로 판정하고, "아무도 노리지 않는다"는 말
// (아무도 지키지 않던, 피했습니다)은 핀에 걸린 기물과 킹까지 세는 attackers()로 판정한다.
// 두 방향 모두 문장이 참인 쪽으로 기운다.
import { Chess } from './vendor/chess.js'

const NAME = { p: '폰', n: '나이트', b: '비숍', r: '룩', q: '퀸', k: '킹' }
const ADJ = { w: '흰', b: '검은' }
// 기물 이름에 조사를 붙인다. particle은 받침이 있을 때의 꼴('이', '을', '으로', '과')로 준다.
// 기물 이름 가운데 나이트만 받침이 없다.
const NO_FINAL = { 이: '가', 을: '를', 으로: '로', 과: '와' }
export function pieceWord(type, particle) {
  if (!(particle in NO_FINAL)) throw new Error(`모르는 조사입니다: ${particle}`)
  return NAME[type] + (type === 'n' ? NO_FINAL[particle] : particle)
}
const iGa = (t) => pieceWord(t, '이')
const eul = (t) => pieceWord(t, '을')
const euro = (t) => pieceWord(t, '으로')
const wa = (t) => pieceWord(t, '과')
// 노리는 기물이 여럿일 때 하나를 고르는 데만 쓴다. 문장에는 쓰지 않는다.
const RANK = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }

export const STATIC_TEXTS = {
  myTurn: '내 차례입니다',
  thinking: '엔진이 생각하는 중입니다…',
  inCheck: '체크입니다. 체크에서 벗어나는 수만 둘 수 있습니다.',
  noTargets: '이 기물은 지금 갈 수 있는 칸이 없습니다.',
  noTargetsInCheck: '지금은 체크입니다. 이 기물로는 체크에서 벗어날 수 없습니다.',
  engineOwnsWhite: '흰 기물은 엔진이 둡니다.',
  engineOwnsBlack: '검은 기물은 엔진이 둡니다.',
  engineMoveLabel: '엔진의 수',
  resignConfirm: '기권하면 엔진이 이긴 것으로 게임이 끝납니다. 기권할까요?',
  undoHint: '무르기를 누르면 내 마지막 수를 두기 전으로 돌아갑니다.',
  wonByMate: '체크메이트 — 이겼습니다!',
  lostByMate: '체크메이트 — 엔진이 이겼습니다',
  draw: '무승부입니다',
  resigned: '기권했습니다 — 엔진이 이겼습니다',
}

// 끝 화면의 제목. outcome은 game-session의 {kind, winner}.
export function endTitle(outcome, userColor) {
  if (outcome.kind === 'resigned') return STATIC_TEXTS.resigned
  if (outcome.kind === 'checkmate') return outcome.winner === userColor ? STATIC_TEXTS.wonByMate : STATIC_TEXTS.lostByMate
  return STATIC_TEXTS.draw
}

function other(color) {
  return color === 'w' ? 'b' : 'w'
}

function kingSquare(chess, color) {
  return chess.findPiece({ type: 'k', color })[0]
}

// 차례만 바꾼 사본. 앙파상 칸은 지운다. 둘 차례가 아닌 쪽이 체크가 아닐 때만 부른다.
function flipped(fen) {
  const parts = fen.split(' ')
  parts[1] = other(parts[1])
  parts[3] = '-'
  return new Chess(parts.join(' '))
}

// 지금 둘 차례인 쪽이 square의 폰을 앙파상으로 잡을 수 있는가. attackers()는 앙파상을 세지 않는다.
function takenEnPassant(game, square) {
  return game.moves({ verbose: true }).some((m) => m.isEnPassant() && m.to[0] + m.from[1] === square)
}

// 문장 끝. 체크도 했으면 "…며 체크했습니다."(움직인 기물이 체크했다)로 바꾼다. 움직인 기물이 아니라 그 뒤에
// 있던 기물이 체크하게 된 드러난 체크면 "…했고, 검은 킹이 체크를 당했습니다."라고 한다. 움직인 기물이 체크했다고
// 하면 거짓이다(킹이 피하며 드러난 체크면 "킹이 체크했다"가 된다). done은 언제나 "…습니다"로 끝난다.
function ending(slots, done, joined) {
  if (!slots.check) return `${done}.`
  if (slots.discovered) return `${done.slice(0, -3)}고, ${ADJ[slots.O]} 킹이 체크를 당했습니다.`
  return `${joined}며 체크했습니다.`
}

const RENDER = {
  MATE: (s) => `체크메이트입니다 — ${ADJ[s.O]} 킹이 체크를 당했고 벗어날 방법이 없습니다.`,
  STALEMATE: (s) => `스테일메이트, 무승부입니다 — ${ADJ[s.O]}색 차례인데 체크는 아니고 둘 수 있는 수가 하나도 없습니다.`,
  INSUFFICIENT: (s) =>
    (s.cap ? `${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡아 ` : '') + '남은 기물로는 어느 쪽도 체크메이트를 만들 수 없어 무승부입니다.',
  REPETITION: () => '똑같은 판 모양이 세 번 되풀이되어 무승부입니다.',
  FIFTY: () => '두 사람이 각각 50번씩 두는 동안 폰이 한 번도 움직이지 않고 아무 기물도 잡히지 않아 무승부입니다.',
  ANS_CAPTURE: (s) =>
    s.promo
      ? ending(s, `체크한 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡고 ${euro(s.promo)} 승격했습니다`, `체크한 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡고 ${euro(s.promo)} 승격하`)
      : ending(s, `체크한 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡았습니다`, `체크한 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡으`),
  ANS_KING: (s) => ending(s, `${ADJ[s.M]} 킹이 ${s.to} 칸으로 피해 체크에서 벗어났습니다`, `${ADJ[s.M]} 킹이 ${s.to} 칸으로 피해 체크에서 벗어나`),
  ANS_KING_CAP: (s) =>
    ending(s, `${ADJ[s.M]} 킹이 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡으며 체크에서 벗어났습니다`, `${ADJ[s.M]} 킹이 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡아 체크에서 벗어나`),
  ANS_BLOCK: (s) =>
    s.promo
      ? ending(s, `${ADJ[s.M]} 폰이 ${s.to} 칸에서 ${euro(s.promo)} 승격해 체크를 막았습니다`, `${ADJ[s.M]} 폰이 ${s.to} 칸에서 ${euro(s.promo)} 승격해 체크를 막으`)
      : ending(s, `${ADJ[s.M]} ${iGa(s.p)} ${s.to} 칸으로 와서 체크를 막았습니다`, `${ADJ[s.M]} ${iGa(s.p)} ${s.to} 칸으로 와서 체크를 막으`),
  PROMO: (s) => ending(s, `${ADJ[s.M]} 폰이 ${s.to} 칸에서 ${euro(s.promo)} 승격했습니다`, `${ADJ[s.M]} 폰이 ${s.to} 칸에서 ${euro(s.promo)} 승격하`),
  PROMO_CAP: (s) =>
    ending(s, `${ADJ[s.M]} 폰이 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡고 ${euro(s.promo)} 승격했습니다`, `${ADJ[s.M]} 폰이 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡고 ${euro(s.promo)} 승격하`),
  EP: (s) => ending(s, `${ADJ[s.M]} 폰이 앙파상으로 ${s.cap} 칸의 ${ADJ[s.O]} 폰을 잡았습니다`, `${ADJ[s.M]} 폰이 앙파상으로 ${s.cap} 칸의 ${ADJ[s.O]} 폰을 잡으`),
  CAP_FREE: (s) =>
    ending(s, `${ADJ[s.M]} ${iGa(s.p)} 아무도 지키지 않던 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡았습니다`, `${ADJ[s.M]} ${iGa(s.p)} 아무도 지키지 않던 ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡으`),
  CAP: (s) => ending(s, `${ADJ[s.M]} ${iGa(s.p)} ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡았습니다`, `${ADJ[s.M]} ${iGa(s.p)} ${s.cap} 칸의 ${ADJ[s.O]} ${eul(s.v)} 잡으`),
  CASTLE: (s) => ending(s, `${s.side} 쪽 캐슬링을 해서 킹은 ${s.to} 칸, 룩은 ${s.rookTo} 칸에 섰습니다`, `${s.side} 쪽 캐슬링을 해서 킹은 ${s.to} 칸, 룩은 ${s.rookTo} 칸에 서`),
  CHECK: (s) => {
    const [a, b] = s.checkers
    if (!b) return `${a.square} 칸의 ${ADJ[s.M]} ${iGa(a.type)} ${ADJ[s.O]} 킹을 노리는 체크입니다.`
    return `${a.square} 칸의 ${ADJ[s.M]} ${wa(a.type)} ${b.square} 칸의 ${ADJ[s.M]} ${iGa(b.type)} 함께 ${ADJ[s.O]} 킹을 노리는 체크입니다.`
  },
  ONLY: (s) => `${ADJ[s.M]}색이 둘 수 있는 수는 이것 하나뿐이었습니다.`,
  ESCAPE: (s) => `${s.a} 칸의 ${ADJ[s.O]} ${iGa(s.ap)} 노리던 ${ADJ[s.M]} ${iGa(s.p)} ${s.to} 칸으로 피했습니다.`,
  THREAT: (s) => `이제 ${s.a} 칸의 ${ADJ[s.M]} ${iGa(s.x)} ${s.t} 칸의 ${ADJ[s.O]} ${eul(s.tp)} 노립니다.`,
  MOVE: (s) => `${ADJ[s.M]} ${iGa(s.p)} ${s.from} 칸에서 ${s.to} 칸으로 갔습니다.`,
}

// game: 수를 둔 뒤의 살아 있는 대국. move: 그 대국의 마지막 수(chess.js의 verbose 수).
// 돌려주는 값은 {id, slots, text}. 대국을 끝낸 수면 id가 MATE, STALEMATE, INSUFFICIENT,
// REPETITION, FIFTY 가운데 하나다.
export function explainMove(game, move) {
  if (game.fen() !== move.after) throw new Error('설명할 수는 대국의 마지막 수여야 합니다')
  const id = pick(game, move)
  return { id: id.id, slots: id.slots, text: RENDER[id.id](id.slots) }
}

function pick(game, move) {
  const M = move.color
  const O = other(M)
  const before = new Chess(move.before)
  const ep = move.isEnPassant()
  const cap = move.captured ? (ep ? move.to[0] + move.from[1] : move.to) : undefined
  const slots = { M, O, p: move.piece, from: move.from, to: move.to, check: game.inCheck() }
  if (cap) {
    slots.cap = cap
    slots.v = move.captured
  }
  if (move.promotion) slots.promo = move.promotion
  // 체크라면 움직인 기물(캐슬링이면 룩)이 체크하는가, 그 뒤에 있던 기물이 체크하게 됐는가.
  const checkers = slots.check ? game.attackers(kingSquare(game, O), M) : []
  const rookTo = move.isKingsideCastle() ? 'f' + move.to[1] : move.isQueensideCastle() ? 'd' + move.to[1] : null
  slots.discovered = slots.check && !checkers.includes(rookTo || move.to)
  const result = (id, extra) => ({ id, slots: Object.assign(slots, extra) })

  // 1~2. 대국을 끝낸 수. 판정 순서는 game-session과 같다.
  if (game.isCheckmate()) return result('MATE')
  if (game.isStalemate()) return result('STALEMATE')
  if (game.isInsufficientMaterial()) return result('INSUFFICIENT')
  if (game.isThreefoldRepetition()) return result('REPETITION')
  if (game.isDrawByFiftyMoves()) return result('FIFTY')

  // 3. 체크에서 벗어난 수.
  if (before.inCheck()) {
    const checkers = before.attackers(kingSquare(before, M), O)
    if (cap && checkers.includes(cap)) return result('ANS_CAPTURE')
    if (move.piece === 'k') return result(cap ? 'ANS_KING_CAP' : 'ANS_KING')
    // 남은 길은 사이를 막는 것뿐이다. 체크하던 기물이 아닌 것을 잡으면서 막는 수는 없다. 줄 위에
    // 상대 기물이 있었다면 체크가 아니었을 것이고, 앙파상의 도착 칸은 체크를 드러낸 줄 위에 올 수 없다.
    return result('ANS_BLOCK')
  }
  // 4~5.
  if (move.promotion) return result(cap ? 'PROMO_CAP' : 'PROMO')
  if (ep) return result('EP')
  // 6~7. 잡기.
  if (cap) {
    const free = before.attackers(cap, O).length === 0 && game.attackers(move.to, O).length === 0
    return result(free ? 'CAP_FREE' : 'CAP')
  }
  // 8.
  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    return result('CASTLE', { side: move.isKingsideCastle() ? '킹' : '퀸', rookTo })
  }
  // 9. 체크. 드러난 체크도 실제로 체크하는 기물을 말한다.
  if (slots.check) {
    return result('CHECK', { checkers: checkers.map((sq) => ({ square: sq, type: game.get(sq).type })) })
  }
  // 10.
  if (before.moves().length === 1) return result('ONLY')
  // 11. 노리던 기물이 피했다. 두 칸 전진해 피한 폰이 앙파상으로 바로 잡힐 수 있으면 피한 것이 아니다.
  const threatened = flipped(move.before)
    .moves({ verbose: true })
    .filter((m) => m.to === move.from)
  if (threatened.length > 0 && game.attackers(move.to, O).length === 0 && !takenEnPassant(game, move.to)) {
    let a = threatened[0]
    for (const m of threatened) if (RANK[m.piece] < RANK[a.piece]) a = m
    return result('ESCAPE', { a: a.from, ap: a.piece })
  }
  // 12. 새로 노리게 된 상대 기물. 상대가 체크가 아닐 때만 여기에 오므로 킹은 대상에 들지 않는다.
  const beforeCaptures = new Set(before.moves({ verbose: true }).map((m) => m.from + m.to))
  let best = null
  for (const m of flipped(game.fen()).moves({ verbose: true })) {
    if (!m.captured) continue
    const origin = m.from === move.to ? move.from : m.from
    if (beforeCaptures.has(origin + m.to)) continue
    const key = RANK[m.captured] * 2 + (m.from === move.to ? 1 : 0)
    if (!best || key > best.key) best = { key, m }
  }
  if (best) return result('THREAT', { a: best.m.from, x: best.m.piece, t: best.m.to, tp: best.m.captured })
  // 13.
  return result('MOVE')
}
