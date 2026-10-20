const KEY = 'chessclass.v1'
const CORRUPT_KEY = 'chessclass.v1.corrupt'

function emptyState() {
  return { version: 1, activeProfile: null, profiles: {} }
}

function isValidProfile(p) {
  return (
    p !== null &&
    typeof p === 'object' &&
    typeof p.displayName === 'string' &&
    Array.isArray(p.completedLessons) &&
    p.stepCursor !== null &&
    typeof p.stepCursor === 'object' &&
    p.puzzleStats !== null &&
    typeof p.puzzleStats === 'object'
  )
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isValidState(v) {
  if (v === null || typeof v !== 'object') return false
  if (v.version !== 1) return false
  if (v.profiles === null || typeof v.profiles !== 'object' || Array.isArray(v.profiles)) return false
  for (const id of Object.keys(v.profiles)) {
    if (!isValidProfile(v.profiles[id])) return false
  }
  if (v.activeProfile != null && !Object.prototype.hasOwnProperty.call(v.profiles, v.activeProfile)) {
    return false
  }
  return true
}

export function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
}

export function browserStorage() {
  try {
    const probe = '__chessclass_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return { storage: window.localStorage, persistent: true }
  } catch (e) {
    return { storage: memoryStorage(), persistent: false }
  }
}

export function createProgress(storage) {
  let corrupted = null
  // 마지막으로 읽거나 쓴 저장소의 글. 저장소가 이것과 다르면 다른 화면이 그사이 저장한 것이다.
  let lastRaw = null
  let state = read()

  function read() {
    const raw = storage.getItem(KEY)
    lastRaw = raw
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (isValidState(parsed)) {
          corrupted = storage.getItem(CORRUPT_KEY)
          return parsed
        }
      } catch (e) {
        // 아래에서 손상으로 처리한다
      }
      corrupted = raw
      try {
        storage.setItem(CORRUPT_KEY, raw)
      } catch (e) {
        // 백업 실패는 무시한다. 원본을 못 지키는 것보다 앱이 뜨는 게 낫다.
      }
      return emptyState()
    }
    corrupted = storage.getItem(CORRUPT_KEY)
    return emptyState()
  }

  function write() {
    const text = JSON.stringify(state)
    storage.setItem(KEY, text)
    lastRaw = text
  }

  // 같은 저장소를 쓰는 다른 화면(맥의 다른 탭)이 그사이 저장한 것을 읽어 온다. 이렇게 하지 않으면 먼저 연 화면이
  // 저장할 때마다 처음 읽은 상태를 통째로 써서 다른 화면의 진도를 지운다(대국은 수마다 저장하므로 자주 일어난다).
  // 저장소가 그대로면 아무것도 하지 않는다(저장 공간이 모자라 쓰지 못한 이 화면의 변경을 지키기 위해서다).
  // 읽은 값이 망가졌으면 지금 것을 그대로 쓴다.
  function refresh() {
    let raw = null
    try {
      raw = storage.getItem(KEY)
    } catch (e) {
      return
    }
    if (!raw || raw === lastRaw) return
    lastRaw = raw
    try {
      const parsed = JSON.parse(raw)
      if (isValidState(parsed)) state = parsed
    } catch (e) {
      // 망가진 값은 무시한다
    }
  }

  function profile(id) {
    refresh()
    const p = state.profiles[id]
    if (!p) throw new Error(`없는 프로필입니다: ${id}`)
    return p
  }

  function nextId() {
    const used = Object.keys(state.profiles)
      .map((k) => parseInt(k.slice(1), 10))
      .filter((n) => Number.isInteger(n))
    return 'p' + (used.length ? Math.max(...used) + 1 : 1)
  }

  return {
    addProfile(displayName) {
      refresh()
      const id = nextId()
      state.profiles[id] = {
        displayName,
        completedLessons: [],
        stepCursor: {},
        puzzleStats: {},
        lastLocation: null,
      }
      if (!state.activeProfile) state.activeProfile = id
      write()
      return id
    },

    listProfiles() {
      refresh()
      return Object.keys(state.profiles).map((id) => ({
        id,
        displayName: state.profiles[id].displayName,
      }))
    },

    renameProfile(id, displayName) {
      profile(id).displayName = displayName
      write()
    },

    setActiveProfile(id) {
      profile(id)
      state.activeProfile = id
      write()
    },

    getActiveProfile() {
      refresh()
      return state.activeProfile
    },

    markLessonComplete(id, lessonId) {
      const p = profile(id)
      if (!p.completedLessons.includes(lessonId)) p.completedLessons.push(lessonId)
      write()
    },

    isLessonComplete(id, lessonId) {
      return profile(id).completedLessons.includes(lessonId)
    },

    listCompletedLessons(id) {
      return profile(id).completedLessons.slice()
    },

    setStepCursor(id, lessonId, index) {
      profile(id).stepCursor[lessonId] = index
      write()
    },

    getStepCursor(id, lessonId) {
      const v = profile(id).stepCursor[lessonId]
      return v === undefined ? 0 : v
    },

    setLastLocation(id, location) {
      profile(id).lastLocation = location
      write()
    },

    getLastLocation(id) {
      const loc = profile(id).lastLocation
      return loc === null || loc === undefined ? null : { ...loc }
    },

    recordPuzzle(id, theme, solved) {
      const p = profile(id)
      const s = p.puzzleStats[theme] || { attempted: 0, solved: 0 }
      p.puzzleStats[theme] = {
        attempted: s.attempted + 1,
        solved: s.solved + (solved ? 1 : 0),
      }
      write()
    },

    getPuzzleStats(id, theme) {
      const s = profile(id).puzzleStats[theme]
      return s ? { ...s } : { attempted: 0, solved: 0 }
    },

    // 자리(key)마다 끝나지 않은 대국 하나. key는 'free'(엔진과 한 판) 또는 레슨 id.
    // games는 진도 검사(isValidProfile)에 들지 않는다. 모양이 이상하면 그 값만 무시한다.
    // 저장 공간이 모자라도 대국은 계속되어야 하므로 실패하면 예외 대신 false를 돌려준다.
    saveGame(id, key, record) {
      const p = profile(id)
      if (!isPlainObject(p.games)) p.games = {}
      p.games[key] = record
      try {
        write()
        return true
      } catch (e) {
        return false
      }
    },

    // 저장한 그대로의 사본. 없거나 객체가 아니면 null. 수를 다시 둘 수 있는지는
    // game-session.js의 restoreGameSession이 판단한다.
    getGame(id, key) {
      const games = profile(id).games
      if (!isPlainObject(games) || !isPlainObject(games[key])) return null
      return JSON.parse(JSON.stringify(games[key]))
    },

    clearGame(id, key) {
      const p = profile(id)
      if (!isPlainObject(p.games) || !Object.prototype.hasOwnProperty.call(p.games, key)) return
      delete p.games[key]
      try {
        write()
      } catch (e) {
        // 지우지 못해도 다음에 이어 두기가 한 번 더 보일 뿐이다.
      }
    },

    getCorruptedRaw() {
      return corrupted
    },

    clearCorrupted() {
      corrupted = null
      storage.removeItem(CORRUPT_KEY)
      // KEY 자체에는 아직 손상된 원문이 남아 있을 수 있다(첫 변경 전까지는
      // read()가 덮어쓰지 않는다). 지금의 정상 상태로 다시 써서 다음
      // 로드 때 같은 원문을 또 손상으로 인식하지 않게 한다.
      write()
    },

    exportJSON() {
      refresh()
      return JSON.stringify(state, null, 2)
    },

    // 전체 상태를 통째로 갈아끼운다. 기존 프로필과 진도는 사라지므로
    // 호출하는 쪽에서 먼저 확인을 받아야 한다.
    importJSON(text) {
      const parsed = JSON.parse(text)
      if (!isValidState(parsed)) throw new Error('진도 파일 형식이 맞지 않습니다')
      state = parsed
      write()
    },
  }
}
