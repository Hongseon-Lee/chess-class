// 대국 화면 하나: 판, 상태 한 줄, 엔진 수의 설명, 무르기와 기권, 끝났을 때의 단추.
// "엔진과 한 판"과 레슨의 대결 스텝이 함께 쓴다. 대국의 상태는 game-session이, 수는 engine이 맡는다.
//
// 한 수의 흐름: 내 수 → (끝났으면 끝 화면) → 상태를 바꾸고 판을 잠근 뒤 화면이 그려지기를 기다린다
// → 엔진이 계산한다 → 내 수를 둔 때부터 0.7초가 지나면 엔진의 수를 놓는다 → 0.25초 뒤 판을 연다.
// 엔진이 생각하는 사이에 무르기·기권·나가기가 있었으면(session.version()이 바뀌었으면) 그 결과를 버린다.
import { createBoard } from './board.js'
import { explainMove, endTitle, STATIC_TEXTS } from './explain.js'

export const ENGINE_DELAY_MS = 700
export const REOPEN_MS = 250

// 실제 시계. 테스트는 시간을 직접 흘리는 가짜를 넣는다.
export const realClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  frame: (fn) => window.requestAnimationFrame(fn),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// container: 비어 있는 요소. session: game-session. options:
//   engine     {chooseMove}. 보통 engine.js 모듈 그대로.
//   intro      엔진의 수가 아직 없을 때 설명 상자에 보일 글(없어도 된다).
//   onSave     (record) => void. 수를 두거나 무르거나 기권할 때마다 부른다.
//   onEnd      (outcome) => void. 대국이 끝나는 순간마다 부른다(무른 뒤 다시 끝나면 또 부른다).
//   endActions [{label, onClick}]. 끝났을 때 보일 단추.
//   clock, confirm  테스트용으로 바꿔 끼운다.
export function mountGame(container, session, options) {
  const { engine, intro = '', onSave = () => {}, onEnd = () => {}, endActions = [] } = options
  const clock = options.clock || realClock
  const ask = options.confirm || ((text) => window.confirm(text))
  const game = session.game
  const userColor = session.userColor

  const boardHost = el('div')
  const status = el('p', 'play-status')
  const hint = el('p', 'muted small play-hint')
  const box = el('div', 'explain-box')
  const label = el('div', 'explain-label small', STATIC_TEXTS.engineMoveLabel)
  const line = el('p', 'explain-text')
  box.append(label, line)
  const controls = el('div', 'row play-controls')
  const undoButton = el('button', 'btn btn-quiet btn-play-control', '무르기')
  const resignButton = el('button', 'btn btn-quiet btn-play-control', '기권')
  controls.append(undoButton, resignButton)
  const ends = el('div', 'play-ends')
  container.append(boardHost, status, hint, box, controls, ends)

  const board = createBoard(boardHost)
  const orientation = userColor === 'w' ? 'white' : 'black'

  // 'user': 내가 둘 수 있다. 'thinking': 엔진 차례. 'cooldown': 엔진이 막 두었고 판이 곧 열린다.
  // 'over': 끝났다. 'gone': 화면을 떠났다.
  let state = 'user'
  let tapMessage = null
  const pending = new Set() // [kind, id]

  function later(ms, fn) {
    const entry = ['timeout', 0]
    entry[1] = clock.setTimeout(() => {
      pending.delete(entry)
      fn()
    }, ms)
    pending.add(entry)
  }

  function nextFrame(fn) {
    const entry = ['frame', 0]
    entry[1] = clock.frame(() => {
      pending.delete(entry)
      fn()
    })
    pending.add(entry)
  }

  function cancelAll() {
    for (const [kind, id] of pending) {
      if (kind === 'timeout') clock.clearTimeout(id)
      else clock.cancelFrame(id)
    }
    pending.clear()
  }

  function save() {
    onSave(session.record())
  }

  function kingInCheck() {
    if (!game.inCheck()) return null
    return game.findPiece({ type: 'k', color: game.turn() })[0]
  }

  function paintStatus() {
    const outcome = session.outcome()
    if (state === 'over') status.textContent = endTitle(outcome, userColor)
    else if (state === 'thinking') status.textContent = STATIC_TEXTS.thinking
    else if (tapMessage) status.textContent = tapMessage
    else status.textContent = game.inCheck() ? STATIC_TEXTS.inCheck : STATIC_TEXTS.myTurn
    status.classList.toggle('play-status-end', state === 'over')
  }

  function render() {
    const last = session.lastMove()
    const outcome = session.outcome()
    board.setPosition(game.fen(), orientation)
    const engineLast = last && last.color === session.engineColor
    board.setHighlights(engineLast ? [last.from, last.to] : [])
    board.setArrows(engineLast ? [[last.from, last.to]] : [])
    board.setCheck(kingInCheck())
    board.setInteractive(state === 'user')

    paintStatus()

    hint.textContent = state === 'over' && session.canUndo() ? STATIC_TEXTS.undoHint : ''

    // 설명 상자: 끝났으면 왜 끝났는지(기권이면 비운다), 아니면 엔진의 마지막 수, 그것도 없으면 안내.
    let text = ''
    let showLabel = false
    if (outcome && outcome.kind !== 'resigned' && last) {
      text = explainMove(game, last).text
      showLabel = engineLast
    } else if (!outcome && engineLast) {
      text = explainMove(game, last).text
      showLabel = true
    } else if (!outcome && !last) {
      text = intro
    }
    line.textContent = text
    label.hidden = !showLabel

    undoButton.disabled = !(state === 'user' || state === 'cooldown' || state === 'over') || !session.canUndo()
    resignButton.disabled = state === 'over'

    ends.replaceChildren()
    if (state === 'over') {
      for (const action of endActions) {
        const b = el('button', 'btn btn-next', action.label)
        b.addEventListener('click', action.onClick)
        ends.appendChild(b)
      }
    }
  }

  function finish() {
    cancelAll()
    state = 'over'
    tapMessage = null
    render()
    // 작은 아이폰(375×667)에서는 끝났을 때 나오는 단추가 화면 아래에 있다. 보이게 내린다.
    const last = ends.lastElementChild
    if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' })
    onEnd(session.outcome())
  }

  function engineTurn(movedAt) {
    state = 'thinking'
    tapMessage = null
    render()
    const token = session.version()
    // 두 프레임을 기다려 "엔진이 생각하는 중" 화면이 실제로 그려진 뒤에 계산한다(계산하는 동안 화면이 멈춘다).
    nextFrame(() => nextFrame(() => {
      if (state !== 'thinking' || session.version() !== token) return
      const result = engine.chooseMove(session.engineRequest())
      const wait = Math.max(0, ENGINE_DELAY_MS - (clock.now() - movedAt))
      later(wait, () => {
        if (state !== 'thinking' || session.version() !== token) return
        if (!result) {
          finish()
          return
        }
        session.applyEngineMove(result)
        save()
        if (session.outcome()) {
          finish()
          return
        }
        state = 'cooldown'
        render()
        later(REOPEN_MS, () => {
          if (state !== 'cooldown') return
          state = 'user'
          render()
        })
      })
    }))
  }

  board.setTargetProvider((square) => {
    if (state !== 'user') return []
    const targets = game.moves({ square, verbose: true }).map((m) => m.to)
    // 움직일 수 있는 기물을 고르면, 앞서 다른 기물에 대해 한 안내("이 기물로는 …")를 지운다.
    // 남겨 두면 지금 고른 기물에 대해 틀린 말이 된다. 판을 다시 그리면 고른 것이 풀리므로 상태 줄만 고친다.
    if (targets.length > 0 && tapMessage) {
      tapMessage = null
      paintStatus()
    }
    return targets
  })

  board.onMove(({ from, to }) => {
    if (state !== 'user') return
    const move = session.userMove({ from, to })
    if (!move) return
    tapMessage = null
    save()
    if (session.outcome()) {
      finish()
      return
    }
    engineTurn(clock.now())
  })

  // 갈 칸이 없는 칸을 누르면 말없이 지나가지 않고 까닭을 알린다.
  board.onNoTargets((square) => {
    if (state !== 'user') return
    const piece = game.get(square)
    if (!piece) tapMessage = null
    else if (piece.color !== userColor) tapMessage = piece.color === 'w' ? STATIC_TEXTS.engineOwnsWhite : STATIC_TEXTS.engineOwnsBlack
    else tapMessage = game.inCheck() ? STATIC_TEXTS.noTargetsInCheck : STATIC_TEXTS.noTargets
    render()
  })

  undoButton.addEventListener('click', () => {
    if (undoButton.disabled) return
    cancelAll()
    if (!session.undo()) return
    state = 'user'
    tapMessage = null
    save()
    render()
  })

  resignButton.addEventListener('click', () => {
    if (state === 'over' || !ask(STATIC_TEXTS.resignConfirm)) return
    if (!session.resign()) return
    save()
    finish()
  })

  // 처음 그리기. 끝난 대국이면 끝 화면, 엔진 차례면(검은색으로 시작했거나 엔진이 생각하던 중에 꺼졌으면)
  // 화면을 그린 뒤 엔진이 둔다.
  if (session.outcome()) {
    state = 'over'
    render()
  } else if (session.turn() === 'engine') {
    engineTurn(clock.now())
  } else {
    render()
  }

  return {
    destroy() {
      state = 'gone'
      cancelAll()
    },
  }
}
