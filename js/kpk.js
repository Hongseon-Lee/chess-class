// 킹+폰 대 킹 표(data/kpk.bin, tools/build_kpk.py가 만든다).
//
// 흰 킹·흰 폰·검은 킹·둘 차례의 모든 칸 조합마다 "흰색이 바르게 두면 이기는가"를 1비트로 담는다(65,536바이트).
// 칸 번호는 a1=0 … h8=63, 자리 = ((흰 킹 × 64 + 흰 폰) × 64 + 검은 킹) × 2 + 둘 차례(흰 0, 검은 1).
// 비트는 바이트 (자리 >> 3)의 (자리 & 7)번째(낮은 비트부터)다. 검은색만 폰을 가진 판은 위아래와 색을 뒤집어 본다.
// 엔진(engine.js)이 이 표로 킹+폰 대 킹에서 무승부를 지킨다(04단원 설계 §4). 표가 없으면 엔진은 원래대로 둔다.

export const KPK_BYTES = 65536

let table = null

// 표를 넣는다. 크기가 다르면 넣지 않고 예외를 던진다.
export function loadKpk(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length !== KPK_BYTES) throw new Error(`킹+폰 표의 크기가 다릅니다: ${bytes.length}바이트`)
  table = bytes
}

// 표를 뺀다(테스트용).
export function clearKpk() {
  table = null
}

function squareIndex(square) {
  return square.charCodeAt(0) - 97 + 8 * (square.charCodeAt(1) - 49)
}

// chess.js 판이 킹+폰 대 킹이면 폰을 가진 쪽이 바르게 두면 이기는가(true/false). 표가 없거나 그런 판이 아니면 null.
export function pawnSideWins(chess) {
  if (!table) return null
  let pawn = null
  const kings = {}
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p) continue
      if (p.type === 'k') kings[p.color] = p.square
      else if (p.type === 'p' && !pawn) pawn = p
      else return null
    }
  }
  if (!pawn || !kings.w || !kings.b) return null
  const strong = pawn.color
  const weak = strong === 'w' ? 'b' : 'w'
  const flip = (square) => (strong === 'w' ? squareIndex(square) : squareIndex(square) ^ 56)
  const stm = chess.turn() === strong ? 0 : 1
  const i = ((flip(kings[strong]) * 64 + flip(pawn.square)) * 64 + flip(kings[weak])) * 2 + stm
  return ((table[i >> 3] >> (i & 7)) & 1) === 1
}
