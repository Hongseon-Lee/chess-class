import { Chess } from './vendor/chess.js'
import { resolveFen } from './lesson-runner.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

const PIECE_FILE = {
  wk: 'Chess_klt45.svg', wq: 'Chess_qlt45.svg', wr: 'Chess_rlt45.svg',
  wb: 'Chess_blt45.svg', wn: 'Chess_nlt45.svg', wp: 'Chess_plt45.svg',
  bk: 'Chess_kdt45.svg', bq: 'Chess_qdt45.svg', br: 'Chess_rdt45.svg',
  bb: 'Chess_bdt45.svg', bn: 'Chess_ndt45.svg', bp: 'Chess_pdt45.svg',
}

const PIECE_NAME = {
  k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰',
}

function isLight(fileIndex, rank) {
  return (fileIndex + rank) % 2 === 0
}

export function createBoard(root) {
  root.classList.add('board')

  const squares = new Map()
  let orientation = 'white'
  let currentFen = null

  function build() {
    root.replaceChildren()
    squares.clear()
    const ranks = orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
    const files = orientation === 'white' ? FILES : FILES.slice().reverse()

    for (const rank of ranks) {
      for (const file of files) {
        const name = file + rank
        const cell = document.createElement('div')
        cell.className = 'sq ' + (isLight(FILES.indexOf(file), rank) ? 'light' : 'dark')
        cell.dataset.square = name

        if (rank === (orientation === 'white' ? 1 : 8)) {
          const label = document.createElement('span')
          label.className = 'coord coord-file'
          label.textContent = file
          cell.appendChild(label)
        }
        if (file === (orientation === 'white' ? 'a' : 'h')) {
          const label = document.createElement('span')
          label.className = 'coord coord-rank'
          label.textContent = String(rank)
          cell.appendChild(label)
        }

        root.appendChild(cell)
        squares.set(name, cell)
      }
    }

    overlay = null
    ensureOverlay()
  }

  function setPosition(fen, nextOrientation) {
    const wanted = nextOrientation || orientation
    if (wanted !== orientation || squares.size === 0) {
      orientation = wanted
      build()
    }
    currentFen = resolveFen(fen)
    const game = new Chess(currentFen)
    const rows = game.board()

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const name = FILES[f] + (8 - r)
        const cell = squares.get(name)
        const existing = cell.querySelector('.piece')
        if (existing) existing.remove()

        const piece = rows[r][f]
        if (!piece) continue

        const img = document.createElement('img')
        img.className = 'piece'
        img.src = './img/pieces/' + PIECE_FILE[piece.color + piece.type]
        img.alt = (piece.color === 'w' ? '흰' : '검은') + ' ' + PIECE_NAME[piece.type]
        img.draggable = false
        cell.appendChild(img)
      }
    }
    paintMarks()
    paintArrows()
    clearSelection()
  }

  let interactive = false
  let selected = null
  let targets = []
  let moveHandler = null
  let targetProvider = (square) => {
    if (!currentFen) return []
    try {
      return new Chess(currentFen).moves({ square, verbose: true }).map((m) => m.to)
    } catch (e) {
      return []
    }
  }

  function paintSelection() {
    for (const cell of squares.values()) {
      cell.classList.remove('selected', 'target')
    }
    if (selected) {
      const cell = squares.get(selected)
      if (cell) cell.classList.add('selected')
      for (const t of targets) {
        const tc = squares.get(t)
        if (tc) tc.classList.add('target')
      }
    }
  }

  function select(square) {
    const found = targetProvider(square)
    if (found.length === 0) {
      clearSelection()
      return
    }
    selected = square
    targets = found
    paintSelection()
  }

  function clearSelection() {
    selected = null
    targets = []
    paintSelection()
  }

  root.addEventListener('click', (event) => {
    if (!interactive) return
    const cell = event.target.closest('.sq')
    if (!cell || !root.contains(cell)) return
    const name = cell.dataset.square

    if (selected === null) {
      select(name)
      return
    }
    if (name === selected) {
      clearSelection()
      return
    }
    if (targets.includes(name)) {
      const from = selected
      clearSelection()
      if (moveHandler) moveHandler({ from, to: name })
      return
    }
    select(name)
  })

  let overlay = null
  let marks = []
  let arrows = []

  function ensureOverlay() {
    if (overlay && overlay.parentNode === root) return overlay
    overlay = document.createElementNS(SVG_NS, 'svg')
    overlay.setAttribute('viewBox', '0 0 100 100')
    overlay.setAttribute('class', 'board-overlay')
    overlay.setAttribute('aria-hidden', 'true')
    root.appendChild(overlay)
    return overlay
  }

  function centerOf(square) {
    const fileIndex = FILES.indexOf(square[0])
    const rank = parseInt(square.slice(1), 10)
    const col = orientation === 'white' ? fileIndex : 7 - fileIndex
    const row = orientation === 'white' ? 8 - rank : rank - 1
    return { x: col * 12.5 + 6.25, y: row * 12.5 + 6.25 }
  }

  function paintMarks() {
    for (const cell of squares.values()) cell.classList.remove('marked')
    for (const name of marks) {
      const cell = squares.get(name)
      if (cell) cell.classList.add('marked')
    }
  }

  function paintArrows() {
    const svg = ensureOverlay()
    svg.replaceChildren()
    for (const pair of arrows) {
      const a = centerOf(pair[0])
      const b = centerOf(pair[1])
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      const ux = dx / len
      const uy = dy / len
      const tipX = b.x - ux * 2.5
      const tipY = b.y - uy * 2.5
      const baseX = tipX - ux * 4.5
      const baseY = tipY - uy * 4.5
      const px = -uy
      const py = ux

      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', String(a.x + ux * 3))
      line.setAttribute('y1', String(a.y + uy * 3))
      line.setAttribute('x2', String(baseX))
      line.setAttribute('y2', String(baseY))
      line.setAttribute('class', 'arrow-line')
      svg.appendChild(line)

      const head = document.createElementNS(SVG_NS, 'polygon')
      head.setAttribute(
        'points',
        `${tipX},${tipY} ${baseX + px * 2.8},${baseY + py * 2.8} ${baseX - px * 2.8},${baseY - py * 2.8}`
      )
      head.setAttribute('class', 'arrow-head')
      svg.appendChild(head)
    }
  }

  function setHighlights(list) {
    marks = Array.isArray(list) ? list : []
    paintMarks()
  }

  function setArrows(list) {
    arrows = Array.isArray(list) ? list : []
    paintArrows()
  }

  build()

  return {
    setPosition,
    getFen: () => currentFen,
    getOrientation: () => orientation,
    squareElement: (name) => squares.get(name) || null,
    setInteractive(v) {
      interactive = !!v
      if (!v) clearSelection()
    },
    onMove(fn) {
      moveHandler = fn
    },
    setTargetProvider(fn) {
      targetProvider = fn
    },
    clearSelection,
    setHighlights,
    setArrows,
  }
}
