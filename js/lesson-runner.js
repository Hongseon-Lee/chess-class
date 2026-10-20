import { Chess } from './vendor/chess.js'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function resolveFen(fen) {
  return fen === 'startpos' ? START_FEN : fen
}

// 이 스텝은 무언가를 해내야 다음으로 넘어간다. 대결은 대국을 끝까지 가야 한다.
function needsAnswer(step) {
  return step.type === 'guided' || step.type === 'quiz' || step.type === 'spar'
}

export function createLessonRunner(lesson) {
  if (!lesson || !Array.isArray(lesson.steps) || lesson.steps.length === 0) {
    throw new Error('스텝이 없는 레슨입니다')
  }

  let index = 0
  let satisfied = false
  let chess = new Chess(resolveFen(lesson.steps[0].fen))

  function step() {
    return lesson.steps[index]
  }

  function enter(i) {
    index = i
    satisfied = false
    chess = new Chess(resolveFen(lesson.steps[i].fen))
  }

  function canAdvance() {
    if (index >= lesson.steps.length) return false
    return !needsAnswer(step()) || satisfied
  }

  function current() {
    if (index >= lesson.steps.length) return null
    const s = step()
    const view = {
      type: s.type,
      fen: chess.fen(),
      orientation: s.orientation || 'white',
      highlight: s.highlight || [],
      arrows: s.arrows || [],
      index,
      total: lesson.steps.length,
    }
    if (s.type === 'explain') view.text = s.text
    if (s.type === 'guided') view.prompt = s.prompt
    if (s.type === 'quiz') {
      view.question = s.question
      view.choices = s.choices.map((c) => ({ text: c.text }))
    }
    if (s.type === 'spar') {
      // 대국은 play-view와 game-session이 맡는다. 여기서는 시작 조건만 알려 준다.
      view.userColor = chess.turn()
      view.orientation = s.orientation || (chess.turn() === 'w' ? 'white' : 'black')
      view.depth = s.depth
      view.goal = s.goal
      view.intro = s.intro
    }
    return view
  }

  function legalTargets(square) {
    if (index >= lesson.steps.length) return []
    try {
      return chess.moves({ square, verbose: true }).map((m) => m.to)
    } catch (e) {
      // 벨트와 멜빵: chess.js는 지금 문자열 square에 대해 던지지 않지만,
      // 앞으로 다른 값이 들어올 수도 있으니 방어적으로 남겨둔다.
      return []
    }
  }

  // 틀린 수에 붙일 안내를 고른다. 수 자체(SAN)에 붙은 안내가 있으면 그것이 먼저다.
  // 같은 칸에 서로 다른 기물이 갈 수 있어서, 도착 칸만으로 정하면 퀸을 보낸 사람에게
  // 할 말이 킹을 보낸 사람에게 나간다.
  function wrongMessage(s, san, to) {
    const onWrong = s.onWrong || {}
    if (san && onWrong.byMove && onWrong.byMove[san]) return onWrong.byMove[san]
    if (onWrong.bySquare && onWrong.bySquare[to]) return onWrong.bySquare[to]
    return onWrong.default || '아직 아닙니다. 다시 해보세요.'
  }

  function submitMove({ from, to, promotion }) {
    if (index >= lesson.steps.length) throw new Error('이미 끝난 레슨입니다')
    const s = step()
    if (s.type !== 'guided') throw new Error('guided 스텝이 아닙니다')

    const probe = new Chess(resolveFen(s.fen))
    let move = null
    try {
      move = probe.move({ from, to, promotion: promotion || 'q' })
    } catch (e) {
      move = null
    }

    if (!move || !s.expect.includes(move.san)) {
      return { ok: false, message: wrongMessage(s, move ? move.san : null, to) }
    }

    chess = probe
    satisfied = true
    return { ok: true, san: move.san, message: s.onRight, fen: chess.fen() }
  }

  function submitChoice(i) {
    if (index >= lesson.steps.length) throw new Error('이미 끝난 레슨입니다')
    const s = step()
    if (s.type !== 'quiz') throw new Error('quiz 스텝이 아닙니다')
    const choice = s.choices[i]
    if (!choice) throw new Error(`없는 선택지입니다: ${i}`)
    if (choice.correct) satisfied = true
    return { ok: !!choice.correct, why: choice.why }
  }

  // 대결 스텝의 대국이 끝까지 갔다(체크메이트, 무승부, 기권 가운데 무엇이든). 지금 목표는
  // 'finish' 하나다. 앱은 다시 열었을 때 그 대국이 한 번이라도 끝까지 갔으면 이것을 부른다.
  function submitGameEnd() {
    if (index >= lesson.steps.length) throw new Error('이미 끝난 레슨입니다')
    const s = step()
    if (s.type !== 'spar') throw new Error('spar 스텝이 아닙니다')
    if (s.goal !== 'finish') throw new Error(`모르는 대결 목표입니다: ${s.goal}`)
    satisfied = true
  }

  function next() {
    if (!canAdvance()) return false
    if (index >= lesson.steps.length - 1) {
      index = lesson.steps.length
      return true
    }
    enter(index + 1)
    return true
  }

  function goTo(i) {
    if (!Number.isInteger(i) || i < 0 || i >= lesson.steps.length) {
      throw new Error(`범위 밖 스텝입니다: ${i}`)
    }
    enter(i)
  }

  function isComplete() {
    return index >= lesson.steps.length
  }

  return {
    current,
    legalTargets,
    submitMove,
    submitChoice,
    submitGameEnd,
    canAdvance,
    next,
    goTo,
    isComplete,
    stepIndex: () => index,
    totalSteps: () => lesson.steps.length,
  }
}
