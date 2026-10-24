// 외통 퍼즐의 판정과 "외통이 아닌 까닭" 문장.
//
// 퍼즐이 정한 정답 수가 아니라 "외통인가"로 판정한다. 그래서 다른 수로 외통을 만들어도 정답이다.
// 판정은 chess.js의 공개 함수로만 하고, 넘겨받은 판은 수를 두어 보고 언제나 되돌려 놓는다.
// 모든 문제의 모든 수에 대해 tools/test_puzzles.py가 python-chess로 다시 확인한다.
import { pieceWord } from './explain.js'

const ADJ = { w: '흰', b: '검은' }

function other(color) {
  return color === 'w' ? 'b' : 'w'
}

function play(chess, m) {
  return chess.move({ from: m.from, to: m.to, promotion: m.promotion })
}

// 사용자가 둘 수 있는 수. 앱은 언제나 퀸으로 승격하므로 다른 승격은 뺀다.
export function userMoves(chess) {
  return chess.moves({ verbose: true }).filter((m) => !m.promotion || m.promotion === 'q')
}

// chess.js는 수를 SAN으로 낼 때 그 수를 두어 보고 체크메이트면 끝에 '#'를 붙인다. 외통인지는 그것으로 읽는다
// (다시 두어 보면 2수 외통 판정이 두 배 넘게 느려진다). 테스트가 isCheckmate()로 두어 본 결과와 견준다.
const MATES = (san) => san.endsWith('#')

// 두면 체크메이트가 되는 사용자의 수.
export function matingMoves(chess) {
  return userMoves(chess).filter((m) => MATES(m.san))
}

// 둘 차례인 사용자에게 외통인 수가 있는가. matingMoves(chess).length > 0과 같되 빠르다(수 객체를 만들지 않는다).
// 퀸이 아닌 승격(SAN의 =R, =B, =N)은 사용자가 둘 수 없으므로 세지 않는다.
export function hasMatingMove(chess) {
  return chess.moves().some((san) => MATES(san) && !/=[RBN]/.test(san))
}

// 상대 차례인 판에서 앱이 상대 대신 둘 수를 고르는 순서: chess.js의 합법 수 목록 순서이되, 퀸이 아닌 승격은
// 맨 뒤로 미룬다. chess.js는 승격을 나이트부터 내므로, 그대로 두면 퀸 승격으로도 될 때 나이트 승격을 보여 준다.
export function replyMoves(game) {
  const moves = game.moves({ verbose: true })
  const under = (m) => Boolean(m.promotion) && m.promotion !== 'q'
  return [...moves.filter((m) => !under(m)), ...moves.filter(under)]
}

// 상대 차례인 판에서, 두면 사용자에게 외통인 수가 없게 되는 상대의 합법 수 가운데 replyMoves 순서로 처음의 것.
// 없으면 null. 상대는 퀸이 아닌 승격도 둘 수 있으므로 그것까지 센다.
// 사용자를 체크메이트시키는 수도 "외통인 수가 없게 되는 수"지만 보여 주면 퍼즐 화면이 다른 문장을 써야 하므로
// (refutedByMate), 그런 수는 다른 막는 수가 하나도 없을 때만 고른다.
// "막는 수"는 코드 안의 이름일 뿐이다. 대개는 막을 위협이 처음부터 없었으므로 화면은 "막는다"고 하지 않는다
// (01단원의 막기는 체크를 사이에서 막는 것이다).
export function refutation(game) {
  let matingReply = null
  for (const r of replyMoves(game)) {
    play(game, r)
    const mate = hasMatingMove(game)
    const matesUser = game.isCheckmate()
    game.undo()
    if (mate) continue
    if (!matesUser) return r
    if (!matingReply) matingReply = r
  }
  return matingReply
}

// 상대 차례인 판에서: 상대가 어떻게 두어도 사용자에게 외통인 수가 있는가. 대국이 끝난 판이면 아니다.
export function everyReplyAllowsMate(game) {
  return !game.isGameOver() && refutation(game) === null
}

// 문장은 "그 수"(사용자가 방금 둔 틀린 수)에 대해 말한다. 퍼즐 화면은 틀린 수를 잠깐 보여 주고 판을 되돌린 뒤에도
// 이 문장을 남겨 두므로, 지금 판이 아니라 그 수를 둔 판에 대한 말이라는 것이 문장에 드러나야 한다.
const RENDER = {
  STALEMATE: () => '그 수를 두면 체크가 아니어서 스테일메이트, 무승부가 됩니다.',
  INSUFFICIENT: () => '그 수를 두면 체크메이트를 만들 기물이 남지 않아 무승부가 됩니다.',
  NOT_CHECK: () => '그 수는 체크가 아닙니다.',
  ESCAPE: (s) => `그 수는 체크지만 ${ADJ[s.O]} 킹이 ${s.sq} 칸으로 피할 수 있습니다.`,
  ESCAPE_CAP: (s) =>
    `그 수는 체크지만 ${ADJ[s.O]} 킹이 ${s.sq} 칸의 ${ADJ[s.M]} ${pieceWord(s.v, '을')} 잡으며 피할 수 있습니다.`,
  CAPTURE: (s) =>
    `그 수는 체크지만 ${s.a} 칸의 ${ADJ[s.O]} ${pieceWord(s.p, '이')} 체크한 ${s.c} 칸의 ${ADJ[s.M]} ${pieceWord(s.q, '을')} 잡을 수 있습니다.`,
  BLOCK: (s) => `그 수는 체크지만 ${s.a} 칸의 ${ADJ[s.O]} ${pieceWord(s.p, '이')} ${s.sq} 칸으로 와서 막을 수 있습니다.`,
}

// game: 사용자가 외통이 아닌 수(move)를 둔 뒤의 판. 까닭 하나를 {id, slots, text}로.
// 대국이 끝났으면(스테일메이트, 기물 부족) 그것을 말한다. 아니면 체크에서 벗어나는 길을 01단원에서 배운 순서로
// 고른다: 피하기(아무것도 잡지 않고, 그다음 체크하지 않은 기물을 잡으며), 잡기, 막기. 같은 종류면 chess.js의 수 목록 순서.
export function whyNotMate(game, move) {
  if (game.fen() !== move.after) throw new Error('설명할 수는 판의 마지막 수여야 합니다')
  if (game.isCheckmate()) throw new Error('외통인 수입니다')
  const M = move.color
  const O = other(M)
  const slots = { M, O }
  const result = (id, extra) => {
    Object.assign(slots, extra)
    return { id, slots, text: RENDER[id](slots) }
  }
  if (game.isStalemate()) return result('STALEMATE')
  if (game.isInsufficientMaterial()) return result('INSUFFICIENT')
  if (!game.inCheck()) return result('NOT_CHECK')

  const king = game.findPiece({ type: 'k', color: O })[0]
  const checkers = game.attackers(king, M)
  const replies = game.moves({ verbose: true })
  // 앙파상이면 잡히는 폰은 도착 칸이 아니라 그 옆에 있다.
  const takenAt = (r) => (r.isEnPassant() ? r.to[0] + r.from[1] : r.to)
  const takesChecker = (r) => Boolean(r.captured) && checkers.includes(takenAt(r))

  const escape = replies.find((r) => r.piece === 'k' && !r.captured)
  if (escape) return result('ESCAPE', { sq: escape.to })
  const escapeCapturing = replies.find((r) => r.piece === 'k' && r.captured && !takesChecker(r))
  if (escapeCapturing) return result('ESCAPE_CAP', { sq: escapeCapturing.to, v: escapeCapturing.captured })
  const capture = replies.find(takesChecker)
  if (capture) {
    const c = takenAt(capture)
    return result('CAPTURE', { a: capture.from, p: capture.piece, c, q: game.get(c).type })
  }
  // 남은 길은 사이를 막는 것뿐이다(체크메이트가 아니므로 반드시 있다).
  const block = replies.find((r) => r.piece !== 'k')
  return result('BLOCK', { a: block.from, p: block.piece, sq: block.to })
}

// 퍼즐 화면의 고정 문장. 테스트가 길이와 말의 규칙을 본다.
export const PUZZLE_TEXTS = {
  findMateIn1: { w: '흰색 차례입니다. 한 수로 체크메이트를 만드세요.', b: '검은색 차례입니다. 한 수로 체크메이트를 만드세요.' },
  findMateIn2: { w: '흰색 차례입니다. 두 수 안에 체크메이트를 만드세요.', b: '검은색 차례입니다. 두 수 안에 체크메이트를 만드세요.' },
  nowMate: '이제 한 수로 체크메이트를 만드세요.',
  correct: '정답입니다!',
  refuted: '상대가 이렇게 두면 다음 수에 체크메이트가 없습니다.',
  refutedByMate: '그 수를 두면 상대가 먼저 체크메이트를 만듭니다.',
  answer: '정답은 이렇습니다.',
  lastMoveLabel: '상대의 마지막 수',
  replyLabel: '상대의 수',
}
