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
  let state = read()

  function read() {
    const raw = storage.getItem(KEY)
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
    storage.setItem(KEY, JSON.stringify(state))
  }

  function profile(id) {
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
