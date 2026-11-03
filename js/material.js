// 기물 점수(02단원). 판 위 기물의 점수를 세고, 대결 화면의 점수 줄과 대결 목표 win-material을 판정한다.
// 화면은 모른다. 점수 줄 문장을 explain.js에 두지 않는 까닭: 엔진 수의 설명에는 '점' 같은 말을 쓰지 않는다는
// 검사가 걸려 있다(01단원만 배운 사람도 보는 문장이다).

export const POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

// 판 위 기물의 점수를 색마다 더한다. 승격한 기물은 그 기물로 센다.
export function materialOf(chess) {
  const sum = { w: 0, b: 0 }
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece) sum[piece.color] += POINTS[piece.type]
    }
  }
  return sum
}

// 대결 화면의 점수 줄. mine은 사용자의 점수, theirs는 엔진의 점수.
export function leadText(mine, theirs) {
  const head = `기물 점수 — 나 ${mine} · 엔진 ${theirs}, `
  if (mine > theirs) return `${head}${mine - theirs}점 앞섭니다`
  if (mine === theirs) return `${head}같습니다`
  return `${head}엔진이 ${theirs - mine}점 앞섭니다`
}

// 대결 목표 win-material(설계 §4). 엔진의 수가 막 놓였을 때(engineJustMoved)와 대국이 끝났을 때 부른다.
// - 내가 체크메이트로 이기면 이룬다. 엔진이 체크메이트하면 이루지 못한다.
// - 판정은 엔진의 수 뒤에만 한다. 내가 잡은 직후의 앞섬은 엔진이 다시 잡으면 사라질 수 있다.
//   엔진의 수로 무승부가 되었어도 그 뒤 lead점 이상 앞서 있으면 이룬다.
export function winMaterialMet(chess, userColor, lead, engineJustMoved) {
  if (chess.isCheckmate()) return chess.turn() !== userColor
  if (!engineJustMoved) return false
  const sum = materialOf(chess)
  const engineColor = userColor === 'w' ? 'b' : 'w'
  return sum[userColor] - sum[engineColor] >= lead
}
