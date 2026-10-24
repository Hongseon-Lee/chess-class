// 외통 퍼즐 문제 화면 하나: 판, 상태 한 줄, 상대 수의 설명, 단추 줄.
// 카드의 문제 화면과 레슨의 퍼즐 스텝이 함께 쓴다. 판정은 puzzle-session이, 문장은 mate.js와 explain.js가 맡는다.
//
// 흐름: 판을 퍼즐의 FEN으로 그린다 → 0.5초 뒤 상대의 첫 수 → 내 수
//   외통      정답. 끝 단추를 보인다
//   틀린 수   까닭을 쓰고 0.5초 동안 그 수를 보여 준 뒤 판을 되돌린다
//   2수 외통의 맞는 첫 수   0.7초 뒤 상대의 수, 그다음 내 수
//   2수 외통의 틀린 첫 수   0.7초 뒤 막는 수, `다시 해 보기`로 처음 자리로
// 두 번 틀리면 `정답 보기`가 생긴다. 누르면 정답 수순을 0.7초 간격으로 둔다.
import { createBoard } from './board.js'
import { explainMove, STATIC_TEXTS } from './explain.js'
import { PUZZLE_TEXTS } from './mate.js'
import { realClock } from './play-view.js'

export const OPENING_DELAY_MS = 500 // 판을 그린 뒤 상대의 첫 수까지
export const WRONG_SHOW_MS = 500 // 틀린 수를 판에 보여 두는 시간
export const REPLY_DELAY_MS = 700 // 내 수 뒤 상대의 수까지, 정답 수순의 수 사이

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// container: 비어 있는 요소. session: 아직 시작하지 않은 puzzle-session. options:
//   onSolved    () => void. 정답 보기 없이 외통을 만든 순간 한 번.
//   onFinished  () => void. 문제를 끝낸 순간 한 번(풀었든 정답을 끝까지 보았든).
//   actions     [{label, onClick}]. 끝났을 때 보일 단추.
//   clock       테스트용으로 바꿔 끼운다.
export function mountPuzzle(container, session, options = {}) {
  const { onSolved = () => {}, onFinished = () => {}, actions = [] } = options
  const clock = options.clock || realClock
  const game = session.game
  const userColor = session.userColor

  const boardHost = el('div')
  const status = el('p', 'play-status')
  const box = el('div', 'explain-box')
  const label = el('div', 'explain-label small')
  const line = el('p', 'explain-text')
  box.append(label, line)
  const controls = el('div', 'row play-controls')
  const revealButton = el('button', 'btn btn-quiet btn-play-control', '정답 보기')
  const retryButton = el('button', 'btn btn-quiet btn-play-control', '다시 해 보기')
  controls.append(revealButton, retryButton)
  const ends = el('div', 'play-ends')
  container.append(boardHost, status, box, controls, ends)

  const board = createBoard(boardHost)
  const orientation = userColor === 'w' ? 'white' : 'black'

  // 'opening': 상대의 첫 수를 기다린다. 'user': 내가 둘 수 있다. 'busy': 수를 보여 주거나 상대의 수를 기다린다.
  // 'refuted': 막는 수를 보여 주었다. 'over': 끝났다. 'gone': 화면을 떠났다.
  let state = 'opening'
  let message = ''
  let tapMessage = null
  const pending = new Set()

  function later(ms, fn) {
    const entry = { id: 0 }
    entry.id = clock.setTimeout(() => {
      pending.delete(entry)
      if (state !== 'gone') fn()
    }, ms)
    pending.add(entry)
  }

  function cancelAll() {
    for (const entry of pending) clock.clearTimeout(entry.id)
    pending.clear()
  }

  function findText() {
    if (session.phase() === 2) return PUZZLE_TEXTS.nowMate
    return (session.theme === 'mateIn1' ? PUZZLE_TEXTS.findMateIn1 : PUZZLE_TEXTS.findMateIn2)[userColor]
  }

  function kingInCheck() {
    if (!game.inCheck()) return null
    return game.findPiece({ type: 'k', color: game.turn() })[0]
  }

  // 설명 상자. 마지막 수가 상대의 수면 그 수를, 끝났으면 마지막 수(외통)를 설명한다.
  // 내 수가 판에 잠깐 놓인 사이에는 앞서 쓴 상대 수의 설명을 그대로 둔다(explainMove는 마지막 수만 설명한다).
  let explained = { text: '', label: null }
  function paintExplain(history) {
    const last = history[history.length - 1]
    if (!last) explained = { text: '', label: null }
    else if (last.color !== userColor) {
      // 상대의 첫 수(판에 수가 하나뿐일 때)는 "상대의 마지막 수", 내 수에 답한 수는 "상대의 수".
      const name = history.length === 1 ? PUZZLE_TEXTS.lastMoveLabel : PUZZLE_TEXTS.replyLabel
      explained = { text: explainMove(game, last).text, label: name }
    } else if (state === 'over') explained = { text: explainMove(game, last).text, label: null }
    line.textContent = explained.text
    label.textContent = explained.label || ''
    label.hidden = !explained.label
  }

  function render() {
    const history = game.history({ verbose: true })
    const last = history[history.length - 1]
    board.setPosition(game.fen(), orientation)
    board.setHighlights(last ? [last.from, last.to] : [])
    board.setArrows(last ? [[last.from, last.to]] : [])
    board.setCheck(kingInCheck())
    board.setInteractive(state === 'user')

    status.textContent = tapMessage || message
    status.classList.toggle('play-status-end', state === 'over')

    paintExplain(history)

    // 수를 보여 주는 동안(busy)에는 단추를 숨기거나 새로 보이지 않고 누를 수만 없게 둔다. 숨겼다 다시 보이면 작은
    // 아이폰에서 틀린 수마다 단추 줄이 비어 화면이 줄었다 늘어나고, 판이 위아래로 흔들린다.
    const showReveal = state === 'busy' ? !revealButton.hidden : state === 'user' && session.canReveal()
    const showRetry = state === 'busy' ? !retryButton.hidden : state === 'refuted'
    const appearing = [[revealButton, showReveal], [retryButton, showRetry]].filter(([b, on]) => on && b.hidden).map(([b]) => b)
    revealButton.hidden = !showReveal
    revealButton.disabled = state !== 'user'
    retryButton.hidden = !showRetry
    // 작은 아이폰(375×667)에서는 판 중간에 생기는 단추도 화면 아래에 걸린다. 생기는 순간 보이게 내린다.
    for (const b of appearing) if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest' })

    ends.replaceChildren()
    if (state === 'over') {
      for (const action of actions) {
        const b = el('button', 'btn btn-next', action.label)
        b.addEventListener('click', action.onClick)
        ends.appendChild(b)
      }
    }
  }

  function setState(next, text) {
    state = next
    message = text
    tapMessage = null
    render()
  }

  // 화면을 끝 상태로 그린 뒤에 알린다. 알리는 쪽(저장 따위)이 실패해도 화면이 멈추지 않는다.
  function finish(text, solved = false) {
    cancelAll()
    setState('over', text)
    // 작은 아이폰(375×667)에서는 끝났을 때 나오는 단추가 화면 아래에 있다. 보이게 내린다.
    const lastAction = ends.lastElementChild
    if (lastAction && lastAction.scrollIntoView) lastAction.scrollIntoView({ block: 'nearest' })
    try {
      if (solved) onSolved()
    } finally {
      onFinished()
    }
  }

  board.setTargetProvider((square) => {
    if (state !== 'user') return []
    const targets = game.moves({ square, verbose: true }).map((m) => m.to)
    // 움직일 수 있는 기물을 고르면 앞서 다른 기물에 대해 한 안내를 지운다(지금 고른 기물에 대해 틀린 말이 된다).
    if (targets.length > 0 && tapMessage) {
      tapMessage = null
      status.textContent = message
    }
    return targets
  })

  board.onNoTargets((square) => {
    if (state !== 'user') return
    const piece = game.get(square)
    if (piece && piece.color === userColor) tapMessage = game.inCheck() ? STATIC_TEXTS.noTargetsInCheck : STATIC_TEXTS.noTargets
    else tapMessage = null
    render()
  })

  board.onMove(({ from, to }) => {
    if (state !== 'user') return
    const result = session.userMove({ from, to })
    if (!result) return
    if (result.kind === 'mate') {
      finish(PUZZLE_TEXTS.correct, true)
    } else if (result.kind === 'wrong') {
      setState('busy', result.why.text)
      later(WRONG_SHOW_MS, () => {
        session.takeBack()
        setState('user', result.why.text)
      })
    } else if (result.kind === 'forcing') {
      setState('busy', '')
      later(REPLY_DELAY_MS, () => {
        session.reply()
        setState('user', PUZZLE_TEXTS.nowMate)
      })
    } else {
      setState('busy', '')
      later(REPLY_DELAY_MS, () => {
        session.playRefutation()
        // 상대의 수가 사용자를 체크메이트시켰으면(그런 수뿐이었으면) 그렇게 말한다.
        setState('refuted', game.isCheckmate() ? PUZZLE_TEXTS.refutedByMate : PUZZLE_TEXTS.refuted)
      })
    }
  })

  retryButton.addEventListener('click', () => {
    if (state !== 'refuted') return
    session.retry()
    setState('user', findText())
  })

  revealButton.addEventListener('click', () => {
    if (state !== 'user' || !session.canReveal()) return
    setState('busy', PUZZLE_TEXTS.answer)
    const step = () => {
      session.revealStep()
      if (session.finished()) {
        finish(PUZZLE_TEXTS.answer)
        return
      }
      render()
      later(REPLY_DELAY_MS, step)
    }
    step()
  })

  render()
  later(OPENING_DELAY_MS, () => {
    session.start()
    setState('user', findText())
  })

  return {
    destroy() {
      state = 'gone'
      cancelAll()
    },
  }
}
