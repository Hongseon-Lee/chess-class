import { createBoard } from './board.js'
import * as engine from './engine.js'
import { createGameSession, restoreGameSession } from './game-session.js'
import { createLessonRunner, START_FEN } from './lesson-runner.js'
import { mountGame } from './play-view.js'
import { createProgress, browserStorage } from './progress.js'

const app = document.getElementById('app')
const { storage, persistent } = browserStorage()
const progress = createProgress(storage)

let curriculum = null

// 서비스워커가 알려준 상태. ready는 앱 파일 한 벌이 실제로 다 저장돼 있다는 뜻이고,
// build는 지금 돌고 있는 배포의 지문이다.
let offline = { ready: false, build: '' }

// 지금 레슨 한가운데인지. 새 배포가 준비돼도 레슨 도중에는 화면을 갈아엎지 않는다.
let inLesson = false

// 새 배포가 준비됐는데 레슨 중이라 미뤄 둔 상태.
let updatePending = false

// 지금 화면에 떠 있는 대국. 다른 화면으로 갈 때 멈춰야 엔진이 떠난 화면에 수를 두지 않는다.
let activeGame = null

function closeActiveGame() {
  if (activeGame) activeGame.destroy()
  activeGame = null
}

// "엔진과 한 판"의 저장 자리. 레슨의 대결은 레슨 id를 자리로 쓴다.
const FREE_GAME = 'free'

const LEVELS = [
  { depth: 1, name: '입문', label: '입문 (가장 쉬움)' },
  { depth: 2, name: '초급', label: '초급' },
  { depth: 3, name: '중급', label: '중급 (가장 어려움)' },
]

const COLORS = [
  { color: 'w', name: '흰색', label: '흰색 · 먼저 둡니다' },
  { color: 'b', name: '검은색', label: '검은색' },
]

// 이어서 둘 수 있는 "엔진과 한 판": 내가 한 수라도 두었고 아직 끝나지 않은 대국. 아니면 null.
// (검은색으로 시작만 해서 엔진의 첫 수만 있거나, 무르기로 내 수가 다 없어진 판은 "두던 대국"이 아니다.)
function playableFreeGame(profileId) {
  const record = progress.getGame(profileId, FREE_GAME)
  const session = record ? restoreGameSession(record) : null
  return session && !session.outcome() && session.canUndo() ? session : null
}

function gameLabel(depth, color) {
  const level = LEVELS.find((l) => l.depth === depth)
  const side = COLORS.find((c) => c.color === color)
  return `${level.name} · ${side.name}`
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label, onClick, className) {
  const b = el('button', className || 'btn', label)
  b.addEventListener('click', onClick)
  return b
}

// 앵커를 문서에 붙였다가 지우고, blob 해제를 미룬다. 사파리는 문서 밖 앵커의
// 클릭을 무시하거나, click() 직후 해제된 blob을 저장하려다 실패하는 경우가 있다.
// 이 함수가 진도 내보내기와 손상 원본 내려받기를 둘 다 떠받치므로 안전한 쪽으로 쓴다.
function download(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function pickFile(onText) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onText(String(reader.result))
    reader.onerror = () => onText(null)
    reader.readAsText(file)
  })
  input.click()
}

function findLesson(lessonId) {
  for (const unit of curriculum.units) {
    for (const lesson of unit.lessons) {
      if (lesson.id === lessonId) return { unit, lesson }
    }
  }
  return null
}

// 같은 순서로 바로 다음에 오는 레슨. 마지막 레슨이거나 다음 레슨의 데이터가 깨져 있으면 null.
function nextLesson(lessonId) {
  const all = curriculum.units.flatMap((unit) => unit.lessons)
  const at = all.findIndex((lesson) => lesson.id === lessonId)
  const next = at >= 0 ? all[at + 1] : null
  if (!next || !next.id || !Array.isArray(next.steps) || next.steps.length === 0) return null
  return next
}

function showError(message, detail) {
  app.replaceChildren()
  app.appendChild(el('h1', null, message))
  if (detail) app.appendChild(el('p', 'muted', detail))
  app.appendChild(button('다시 시도', () => location.reload()))
  if (curriculum) app.appendChild(button('목록으로', showUnitList, 'btn btn-quiet'))
}

function showProfilePicker() {
  if (applyPendingUpdate()) return
  closeActiveGame()
  inLesson = false
  app.replaceChildren()
  app.appendChild(el('h1', null, '누가 배우나요?'))

  if (!persistent) {
    app.appendChild(
      el('p', 'notice', '이 브라우저에서는 저장이 막혀 있어 진도가 이번 세션에만 유지됩니다.')
    )
  }

  const broken = progress.getCorruptedRaw()
  if (broken) {
    const warn = el('div', 'notice notice-warn')
    warn.appendChild(
      el('p', null, '저장된 진도를 읽을 수 없어 새로 시작합니다. 지우기 전에 원본을 내려받아 두세요.')
    )
    let downloaded = false
    warn.appendChild(
      button('원본 내려받기', () => {
        download(broken, 'chess-class-progress-broken.txt', 'text/plain')
        downloaded = true
      }, 'btn btn-quiet')
    )
    warn.appendChild(
      button('원본 지우고 닫기', () => {
        if (!downloaded && !confirm('원본을 아직 내려받지 않았습니다. 지우면 되돌릴 수 없습니다. 계속할까요?')) return
        progress.clearCorrupted()
        showProfilePicker()
      }, 'btn btn-quiet')
    )
    app.appendChild(warn)
  }

  const list = el('div', 'profile-list')
  const activeId = progress.getActiveProfile()
  for (const p of progress.listProfiles()) {
    const isActive = p.id === activeId
    list.appendChild(
      button(p.displayName + (isActive ? '  (지금 사용 중)' : ''), () => {
        progress.setActiveProfile(p.id)
        showUnitList()
      }, 'btn btn-profile' + (isActive ? ' active' : ''))
    )
  }
  app.appendChild(list)

  const input = el('input', 'text-input')
  input.type = 'text'
  input.placeholder = '이름을 넣고 추가하세요'
  input.maxLength = 20
  app.appendChild(input)

  const nameStatus = el('p', 'feedback')

  function addProfile() {
    const name = input.value.trim()
    if (!name) {
      nameStatus.className = 'feedback bad'
      nameStatus.textContent = '이름을 먼저 넣어주세요.'
      input.focus()
      return
    }
    if (progress.listProfiles().some((p) => p.displayName === name)) {
      nameStatus.className = 'feedback bad'
      nameStatus.textContent = '이미 있는 이름입니다. 다른 이름을 써주세요.'
      input.focus()
      return
    }
    const id = progress.addProfile(name)
    progress.setActiveProfile(id)
    showUnitList()
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addProfile()
  })

  app.appendChild(button('프로필 추가', addProfile))
  app.appendChild(nameStatus)
}

function showUnitList() {
  if (applyPendingUpdate()) return
  closeActiveGame()
  inLesson = false
  const profileId = progress.getActiveProfile()
  app.replaceChildren()

  const header = el('div', 'row')
  header.appendChild(el('h1', null, '체스 클래스'))
  const active = progress.listProfiles().find((p) => p.id === profileId)
  if (active) header.appendChild(el('span', 'who', active.displayName))
  header.appendChild(button('프로필 바꾸기', showProfilePicker, 'btn btn-quiet'))
  app.appendChild(header)

  app.appendChild(
    el('p', 'muted', '맥과 아이폰의 진도는 따로 저장됩니다. 기기를 옮길 때는 진도 내보내기를 쓰세요.')
  )

  const play = button('', showPlaySetup, 'btn btn-play')
  play.appendChild(el('div', null, '엔진과 한 판'))
  play.appendChild(el('div', 'muted', '난이도를 골라 컴퓨터 상대(엔진)와 처음부터 끝까지 둡니다'))
  if (playableFreeGame(profileId)) play.appendChild(el('div', 'muted', '두던 대국이 있습니다'))
  app.appendChild(play)

  for (const unit of curriculum.units) {
    app.appendChild(el('h2', null, unit.title))
    app.appendChild(el('p', 'muted', unit.subtitle))
    for (const lesson of unit.lessons) {
      if (!lesson.id || !Array.isArray(lesson.steps) || lesson.steps.length === 0) {
        const locked = el('div', 'btn btn-lesson locked')
        locked.textContent = '잠김  ' + (lesson.title || '이름 없는 레슨') + ' — 데이터가 손상되었습니다'
        app.appendChild(locked)
        continue
      }
      const done = progress.isLessonComplete(profileId, lesson.id)
      const label = (done ? '완료  ' : '') + lesson.title
      app.appendChild(
        button(label, () => showLesson(lesson.id), 'btn btn-lesson' + (done ? ' done' : ''))
      )
    }
  }

  const status = el('p', 'feedback')
  const tools = el('div', 'row')

  tools.appendChild(
    button('진도 내보내기', () => {
      download(progress.exportJSON(), 'chess-class-progress.json')
      status.className = 'feedback good'
      status.textContent = '진도 파일을 내보냈습니다. 다운로드 목록에 있는지 확인해 주세요.'
    }, 'btn btn-quiet')
  )

  tools.appendChild(
    button('진도 불러오기', () => {
      if (progress.listProfiles().length > 0 &&
          !confirm('불러오면 이 기기의 프로필과 진도가 파일 내용으로 완전히 바뀝니다. 계속할까요?')) {
        return
      }
      pickFile((text) => {
        if (text === null) {
          status.className = 'feedback bad'
          status.textContent = '파일을 읽지 못했습니다.'
          return
        }
        try {
          progress.importJSON(text)
        } catch (e) {
          status.className = 'feedback bad'
          status.textContent = '진도 파일 형식이 맞지 않습니다. 기존 진도는 그대로입니다.'
          return
        }
        const active = progress.getActiveProfile()
        if (active && progress.listProfiles().some((p) => p.id === active)) showUnitList()
        else showProfilePicker()
      })
    }, 'btn btn-quiet')
  )

  app.appendChild(tools)
  app.appendChild(status)

  const note = el('p', 'muted small offline-note')
  app.appendChild(note)
  renderOfflineNotes()
}

function renderOfflineNotes() {
  for (const note of document.querySelectorAll('.offline-note')) {
    note.hidden = !offline.ready
    note.textContent = '오프라인 준비 완료 — 인터넷이 없어도 열립니다. 버전 ' + offline.build
  }
}

// 새 배포로 바꿔 끼울 준비가 됐으면 화면을 새로 불러온다. 불러왔으면 true.
function applyPendingUpdate() {
  if (!updatePending) return false
  updatePending = false
  location.reload()
  return true
}

function showPlaySetup() {
  if (applyPendingUpdate()) return
  closeActiveGame()
  inLesson = false
  const profileId = progress.getActiveProfile()
  app.replaceChildren()

  const header = el('div', 'row')
  header.appendChild(button('← 목록', showUnitList, 'btn btn-quiet'))
  header.appendChild(el('h1', 'play-label', '엔진과 한 판'))
  app.appendChild(header)

  const record = progress.getGame(profileId, FREE_GAME)
  const saved = playableFreeGame(profileId)
  if (record && !saved) {
    // 끝났거나 내가 한 수도 두지 않은 대국은 "두던 대국"으로 보이지 않게 말없이 지운다(체크메이트·무승부는 그 화면에서
    // 무를 수 있었지만, 나간 뒤에는 버린다). 되살릴 수 없는 기록이면 알린다.
    const finished = restoreGameSession(record)
    progress.clearGame(profileId, FREE_GAME)
    if (!finished) app.appendChild(el('p', 'notice notice-warn', '저장된 대국을 이어갈 수 없어 새로 시작합니다.'))
  }
  if (saved) {
    // 수는 레슨에서처럼 한 쪽이 한 번 두는 것이다. 양쪽이 둔 수를 모두 센다.
    const label = `이어서 두기 — ${gameLabel(saved.depth, saved.userColor)} · 지금까지 ${saved.record().moves.length}수`
    app.appendChild(button(label, () => showFreeGame(saved), 'btn btn-next'))
  }

  let depth = 1
  let color = 'w'
  function choices(title, options, isOn, pick) {
    app.appendChild(el('h2', null, title))
    const group = el('div', 'choices')
    const buttons = options.map((option) => {
      const b = button(option.label, () => {
        pick(option)
        paint()
      }, 'btn btn-option')
      group.appendChild(b)
      return [b, option]
    })
    function paint() {
      for (const [b, option] of buttons) {
        b.classList.toggle('active', isOn(option))
        b.setAttribute('aria-pressed', String(isOn(option)))
      }
    }
    paint()
    app.appendChild(group)
  }
  choices('상대', LEVELS, (l) => l.depth === depth, (l) => { depth = l.depth })
  choices('내 색', COLORS, (c) => c.color === color, (c) => { color = c.color })

  app.appendChild(button('시작', () => {
    if (saved && !confirm('두던 대국은 사라집니다. 새로 시작할까요?')) return
    progress.clearGame(profileId, FREE_GAME)
    showFreeGame(createGameSession({ startFen: START_FEN, depth, userColor: color }))
  }, 'btn btn-start'))
}

// 저장이 안 돼도 대국은 계속된다. 다만 앱을 닫으면 이어 둘 수 없다는 것을 조용히 알린다.
function saveNotice() {
  const note = el('p', 'muted small', '이 기기에 대국을 저장하지 못했습니다. 앱을 닫으면 이어서 둘 수 없습니다.')
  note.hidden = true
  return note
}

function showFreeGame(session) {
  closeActiveGame()
  inLesson = true
  const profileId = progress.getActiveProfile()
  app.replaceChildren()

  const header = el('div', 'row')
  header.appendChild(button('← 목록', showUnitList, 'btn btn-quiet'))
  header.appendChild(el('div', 'play-label', gameLabel(session.depth, session.userColor)))
  app.appendChild(header)
  const host = el('div')
  app.appendChild(host)
  const note = saveNotice()
  app.appendChild(note)

  const save = (record) => {
    note.hidden = progress.saveGame(profileId, FREE_GAME, record)
  }
  // 처음 그릴 때는 저장하지 않는다. 시작만 누르고 나간 판이 "두던 대국"으로 남지 않게 한다.
  // 수가 놓일 때마다 onSave가 저장한다(검은색이면 엔진의 첫 수부터).
  activeGame = mountGame(host, session, {
    engine,
    onSave: save,
    endActions: [
      {
        label: '한 판 더',
        onClick: () => {
          progress.clearGame(profileId, FREE_GAME)
          showFreeGame(createGameSession({ startFen: session.startFen, depth: session.depth, userColor: session.userColor }))
        },
      },
      {
        label: '목록으로',
        onClick: () => {
          progress.clearGame(profileId, FREE_GAME)
          showUnitList()
        },
      },
    ],
  })
}

function showLesson(lessonId) {
  closeActiveGame()
  const found = findLesson(lessonId)
  if (!found) {
    showError('레슨을 찾을 수 없습니다', lessonId)
    return
  }

  const profileId = progress.getActiveProfile()

  let runner
  try {
    runner = createLessonRunner(found.lesson)
  } catch (e) {
    showError('이 레슨을 열 수 없습니다', `${found.lesson.title}: ${e.message}`)
    return
  }

  // 불러온 진도 파일에 숫자가 아닌 값이 들어 있어도 레슨은 처음부터 열려야 한다.
  const startAt = progress.getStepCursor(profileId, lessonId)
  if (Number.isInteger(startAt) && startAt > 0 && startAt < runner.totalSteps()) runner.goTo(startAt)

  inLesson = true
  app.replaceChildren()

  const header = el('div', 'row')
  header.appendChild(button('← 목록', showUnitList, 'btn btn-quiet'))
  const title = el('div', 'lesson-title')
  title.appendChild(el('div', null, found.lesson.title))
  const counter = el('div', 'muted small')
  title.appendChild(counter)
  header.appendChild(title)
  app.appendChild(header)

  const boardHost = el('div')
  app.appendChild(boardHost)
  const board = createBoard(boardHost)

  // 대결 스텝의 대국 화면. 그 스텝에 들어올 때 한 번 띄우고, 떠날 때 멈춘다.
  const gameHost = el('div')
  app.appendChild(gameHost)
  let sparOn = false

  const panel = el('div', 'panel')
  app.appendChild(panel)

  const feedback = el('div', 'feedback')
  app.appendChild(feedback)

  const controls = el('div', 'row')
  app.appendChild(controls)

  // 휴대폰에서는 답한 뒤의 안내 문구와 '다음' 버튼이 화면 아래로 밀려 안 보일 수 있다.
  // 답을 처리한 직후에만 그쪽을 보여준다. 새 스텝으로 넘어갈 때는 맨 위로 돌아간다.
  function revealAnswer() {
    const target = controls.lastElementChild || feedback
    if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' })
  }

  board.onMove(({ from, to }) => {
    const result = runner.submitMove({ from, to })
    feedback.className = 'feedback ' + (result.ok ? 'good' : 'bad')
    feedback.textContent = result.message
    render()
    revealAnswer()
  })

  board.setTargetProvider((square) => runner.legalTargets(square))

  function finish() {
    let saveError = null
    try {
      progress.markLessonComplete(profileId, lessonId)
      progress.setStepCursor(profileId, lessonId, 0)
    } catch (e) {
      saveError = e.message
    }
    inLesson = false
    app.replaceChildren()
    app.appendChild(el('h1', null, '레슨 완료'))
    app.appendChild(el('p', null, `${found.lesson.title} 레슨을 마쳤습니다.`))
    if (saveError) {
      app.appendChild(
        el('p', 'notice notice-warn', '다만 진도를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
      )
    }
    const next = nextLesson(lessonId)
    if (next) {
      app.appendChild(button('다음 레슨: ' + next.title, () => showLesson(next.id), 'btn btn-next'))
      app.appendChild(button('목록으로', showUnitList, 'btn btn-quiet'))
    } else {
      app.appendChild(button('목록으로', showUnitList))
    }
  }

  // 저장해 둔 대국이 이 스텝의 것이면 이어 두고, 아니면 새로 시작한다.
  function startSpar(view) {
    const record = progress.getGame(profileId, lessonId)
    let session = record ? restoreGameSession(record) : null
    if (session && (session.startFen !== view.fen || session.depth !== view.depth || session.userColor !== view.userColor)) {
      session = null // 레슨 내용이 바뀌었다
    }
    if (record && !session) {
      progress.clearGame(profileId, lessonId)
      feedback.className = 'feedback bad'
      feedback.textContent = '저장된 대국을 이어갈 수 없어 새로 시작합니다.'
    }
    if (!session) session = createGameSession({ startFen: view.fen, depth: view.depth, userColor: view.userColor })
    if (session.reachedEnd()) runner.submitGameEnd()
    const note = saveNotice()
    const save = (rec) => {
      note.hidden = progress.saveGame(profileId, lessonId, rec)
      // "새로 시작합니다" 안내는 첫 수가 놓이면 거둔다.
      if (rec.moves.length > 0 && feedback.textContent) {
        feedback.textContent = ''
        feedback.className = 'feedback'
        feedback.hidden = true
      }
    }
    save(session.record())
    activeGame = mountGame(gameHost, session, {
      engine,
      intro: view.intro,
      onSave: save,
      onEnd: () => {
        runner.submitGameEnd()
        render()
        revealAnswer() // 작은 아이폰에서는 끝났을 때 나오는 '다음'이 화면 아래에 있다
      },
    })
    gameHost.appendChild(note)
    sparOn = true
  }

  function stopSpar() {
    closeActiveGame()
    gameHost.replaceChildren()
    sparOn = false
  }

  function render() {
    if (runner.isComplete()) {
      finish()
      return
    }

    const view = runner.current()
    counter.textContent = `${view.index + 1} / ${view.total}`

    panel.replaceChildren()
    controls.replaceChildren()

    // 대결 스텝에서는 대국 화면이 판과 글을 다 갖고 있다. 빈 칸이 아이폰 화면 아래로 단추를 밀지 않게 숨긴다.
    boardHost.hidden = view.type === 'spar'
    panel.hidden = view.type === 'spar'
    if (view.type === 'spar') {
      if (!sparOn) startSpar(view)
      feedback.hidden = !feedback.textContent
    } else {
      feedback.hidden = false
      board.setPosition(view.fen, view.orientation)
      board.setHighlights(view.highlight)
      board.setArrows(view.arrows)
      board.setInteractive(view.type === 'guided' && !runner.canAdvance())
    }

    if (view.type === 'explain') {
      panel.appendChild(el('p', null, view.text))
    }

    if (view.type === 'guided') {
      panel.appendChild(el('p', 'prompt', view.prompt))
    }

    if (view.type === 'quiz') {
      panel.appendChild(el('p', 'prompt', view.question))
      const choices = el('div', 'choices')
      const solved = runner.canAdvance()
      view.choices.forEach((choice, i) => {
        const b = button(choice.text, () => {
          const result = runner.submitChoice(i)
          feedback.className = 'feedback ' + (result.ok ? 'good' : 'bad')
          feedback.textContent = result.why
          render()
          revealAnswer()
        }, 'btn btn-choice')
        b.disabled = solved
        choices.appendChild(b)
      })
      panel.appendChild(choices)
    }

    if (runner.canAdvance()) {
      controls.appendChild(
        button('다음', () => {
          feedback.textContent = ''
          feedback.className = 'feedback'
          if (sparOn) {
            stopSpar()
            progress.clearGame(profileId, lessonId)
          }
          try {
            runner.next()
          } catch (e) {
            showError('레슨을 이어갈 수 없습니다', `${found.lesson.title}: ${e.message}`)
            return
          }
          try {
            progress.setStepCursor(profileId, lessonId, runner.stepIndex())
          } catch (e) {
            // 저장 공간이 모자라도 레슨은 이어 간다. 완료 화면이 저장하지 못했다고 따로 알린다.
          }
          render()
          window.scrollTo(0, 0)
        })
      )
    }
  }

  render()
}

async function start() {
  try {
    const response = await fetch('./data/curriculum.json')
    if (!response.ok) throw new Error('HTTP ' + response.status)
    curriculum = await response.json()
  } catch (e) {
    showError('레슨을 못 불러왔습니다', e.message)
    return
  }

  const active = progress.getActiveProfile()
  if (active && progress.listProfiles().some((p) => p.id === active)) showUnitList()
  else showProfilePicker()

  // 무사히 떴다. index.html의 안전망이 다음에도 한 번은 스스로 다시 불러올 수 있게 표시를 지운다.
  try {
    sessionStorage.removeItem('chessclass.bootRetry')
  } catch (e) {
    // 저장이 막힌 브라우저에서는 표시도 남지 않는다.
  }
}

start()

if ('serviceWorker' in navigator) {
  const workers = navigator.serviceWorker
  // 이 화면이 뜰 때 이미 워커가 맡고 있었는가. 그렇다면 나중에 맡는 워커가 바뀌는 것은
  // 새 배포가 자리를 잡았다는 뜻이다.
  const wasControlled = Boolean(workers.controller)

  const askStatus = (registration) => {
    const worker = registration.active
    if (!worker) return
    const channel = new MessageChannel()
    channel.port1.onmessage = (event) => {
      offline = { ready: Boolean(event.data && event.data.complete), build: String((event.data && event.data.build) || '') }
      renderOfflineNotes()
    }
    worker.postMessage({ type: 'status' }, [channel.port2])
  }

  // 등록에 실패해도 앱은 그대로 쓸 수 있다. 오프라인 지원만 빠진다.
  workers.register('./sw.js').catch(() => {})
  workers.ready.then(askStatus).catch(() => {})

  workers.addEventListener('controllerchange', () => {
    workers.ready.then(askStatus).catch(() => {})
    if (!wasControlled) return
    // 새 배포의 파일 한 벌이 다 준비됐다. 지금 화면은 옛 파일로 떠 있으므로 새로 불러온다.
    // 레슨 도중이면 끝내고 목록으로 돌아갈 때까지 미룬다.
    updatePending = true
    if (!inLesson) applyPendingUpdate()
  })

  // 홈 화면 앱은 껐다 켜지 않고 다시 꺼내 쓰는 일이 많다. 그때도 새 배포가 있는지 본다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    workers.ready.then((registration) => registration.update()).catch(() => {})
  })
}
