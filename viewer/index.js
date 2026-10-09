// Viewer de l'anneau : parcourt les nœuds à partir d'un point d'entrée, vérifie que
// successeurs, prédécesseurs et clefs sont cohérents, puis dessine l'anneau.

// Taille logique du canvas, indépendante de la densité de pixels de l'écran
const canvasSize = 796
const center = { x: 398, y: 398 }
const radius = 310
const textRadius = 350
const keyRadius = 290
const responsibilityRadius = 268
const maxListed = 30
// Durée pendant laquelle un nœud qui vient d'arriver est mis en évidence
const newNodeDuration = 20000

/**
 * @type { HTMLCanvasElement }
 */ // @ts-ignore
const canvas = document.getElementById('canvas')
/**
 * @type { CanvasRenderingContext2D }
 */ // @ts-ignore
const ctx = canvas.getContext('2d')
/**
 * @type { HTMLInputElement }
 */ // @ts-ignore
const entryInput = document.getElementById('entryPoint')
/**
 * @type { HTMLInputElement }
 */ // @ts-ignore
const lookupInput = document.getElementById('lookupKey')
/**
 * @type { HTMLButtonElement }
 */ // @ts-ignore
const showButton = document.getElementById('show')
/**
 * @type { HTMLSelectElement }
 */ // @ts-ignore
const refreshSelect = document.getElementById('refresh')
const tooltip = document.getElementById('tooltip')
const statusEl = document.getElementById('status')
const summaryEl = document.getElementById('summary')
const problemsEl = document.getElementById('problems')
const nodesEl = document.getElementById('nodes')
const detailsEl = document.getElementById('details')
const lookupResultEl = document.getElementById('lookupResult')

// Hacher les clefs nécessite un contexte sécurisé : ouvrir le viewer via http://localhost
const canHash = Boolean(globalThis.crypto?.subtle)

// Résultat de la dernière exploration, cf. analyse()
let state = null
// URL du nœud sélectionné
let selectedUrl = null
// Dernier test de lookup : { key, id, expected, pending, actual?, error? }
let lookup = null
// Incrémenté à chaque exploration, pour ignorer les résultats d'une exploration dépassée
let generation = 0
// Point d'entrée de l'anneau affiché, réutilisé par l'actualisation automatique
let currentEntry = null
let refreshTimer = null
// Date à laquelle chaque nœud est apparu, pour mettre en évidence les nouveaux
/** @type { Map<string, number> } */
const firstSeen = new Map()
// Rayon des nœuds, réduit quand ils sont nombreux
let nodeSize = 15

function shortUrl (url) {
  return String(url).replace(/^https?:\/\//, '')
}

function label (node) {
  return Number.isInteger(node.id) ? `${shortUrl(node.url)} (id ${node.id})` : shortUrl(node.url)
}

function el (tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) {
    element.textContent = text
  }
  if (className) {
    element.className = className
  }
  return element
}

// L'anneau commence en haut et tourne dans le sens des aiguilles d'une montre
function angleOf (id) {
  return id * 2 * Math.PI / state.nbPoints - Math.PI / 2
}

function position (id, r = radius) {
  const angle = angleOf(id)
  return { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) }
}

function isNew (node) {
  return Date.now() - (firstSeen.get(node.url) ?? 0) < newNodeDuration
}

// Même calcul que getIdFromString dans index.js
async function getIdFromString (data, m) {
  const buffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data))
  const bitString = Array.from(new Uint8Array(buffer)).map(byte => byte.toString(2).padStart(8, '0')).join('').slice(-m)
  return parseInt(bitString, 2)
}

// Renvoie la réponse JSON, ou null si le nœud est injoignable ou répond une erreur
async function fetchJson (url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

// Interroge les nœuds vague par vague : tous les voisins découverts à une vague
// sont interrogés en parallèle à la suivante
async function exploreDht (entryPoint) {
  /**
   * @type { { url: string, id?: number }[] }
   */
  let wave = [{ url: entryPoint }]
  const visited = new Set()
  /**
   * @type { {
   *   id: number,
   *   url: string,
   *   size: number,
   *   successor: { id: number, url: string },
   *   predecessor: { id: number, url: string },
   * }[] }
   **/
  const nodes = []
  /**
   * Nœuds cités comme voisins mais qui ne répondent pas
   * @type { { url: string, id?: number, dead: true }[] }
   **/
  const deadNodes = []

  while (wave.length > 0) {
    for (const { url } of wave) {
      visited.add(url)
    }

    const configs = await Promise.all(wave.map(({ url }) => fetchJson(`${url}/config`)))
    const next = []

    for (const [i, { url, id }] of wave.entries()) {
      const config = configs[i]

      if (typeof config !== 'object' || config === null) {
        deadNodes.push({ url, id, dead: true })
        continue
      }

      // Le point d'entrée a pu être saisi autrement que l'URL annoncée par le nœud
      if (config.url !== url) {
        if (visited.has(config.url)) {
          continue
        }
        visited.add(config.url)
      }

      nodes.push(config)

      for (const neighbour of [config.successor, config.predecessor]) {
        if (neighbour?.url && !visited.has(neighbour.url) && !next.some(other => other.url === neighbour.url)) {
          next.push(neighbour)
        }
      }
    }

    wave = next
  }

  return { entryPoint, nodes, deadNodes }
}

// Vérifie la cohérence de l'anneau exploré
function analyse ({ entryPoint, nodes, deadNodes }) {
  /**
   * Problèmes détectés, avec les URLs des nœuds concernés
   * @type { { urls: string[], text: string }[] }
   */
  const problems = []
  const report = (node, text) => problems.push({ urls: [node.url], text: `${label(node)} : ${text}` })

  // La taille de référence est celle du point d'entrée
  const size = nodes[0].size
  const validSize = Number.isInteger(size) && size >= 1 && size <= 32
  const nbPoints = 2 ** size
  const isPosition = id => Number.isInteger(id) && id >= 0 && id < nbPoints

  if (!validSize) {
    report(nodes[0], `taille d'anneau invalide : ${JSON.stringify(size)}`)
  }

  const placed = []
  const unplaced = []

  for (const node of nodes) {
    if (!validSize) {
      unplaced.push(node)
    } else if (node.size !== size) {
      report(node, `anneau de taille 2^${node.size} alors que ${shortUrl(nodes[0].url)} utilise 2^${size}. Tous les nœuds doivent avoir le même --size`)
      unplaced.push(node)
    } else if (!isPosition(node.id)) {
      report(node, `identifiant non calculé ou invalide : ${JSON.stringify(node.id)}`)
      unplaced.push(node)
    } else {
      placed.push(node)
    }
  }

  const sorted = [...placed].sort((a, b) => a.id - b.id || String(a.url).localeCompare(String(b.url)))
  const deadPlaced = deadNodes.filter(node => validSize && isPosition(node.id))
  // Couleurs bien distinctes entre voisins, dans l'ordre de l'anneau
  const colors = new Map(sorted.map((node, i) => [node.url, `hsl(${Math.round(i * 137.5) % 360}, 70%, 40%)`]))

  // Collisions : plusieurs nœuds au même identifiant
  /** @type { Map<number, typeof sorted> } */
  const byId = new Map()
  for (const node of sorted) {
    byId.set(node.id, [...(byId.get(node.id) ?? []), node])
  }
  const collisions = [...byId.values()].filter(group => group.length > 1)
  for (const group of collisions) {
    problems.push({
      urls: group.map(node => node.url),
      text: `Collision : ${group.map(node => shortUrl(node.url)).join(', ')} ont le même identifiant ${group[0].id}. Changez de port ou augmentez --size`,
    })
  }

  // Successeurs et prédécesseurs
  const byUrl = new Map(nodes.map(node => [node.url, node]))
  const placedUrls = new Set(sorted.map(node => node.url))
  const deadByUrl = new Map(deadNodes.map(node => [node.url, node]))
  const names = { successor: 'successeur', predecessor: 'prédécesseur' }
  const reverse = { successor: 'predecessor', predecessor: 'successor' }
  /**
   * Liens à dessiner, status vaut 'ok', 'error' ou 'dead'
   * @type { { from: object, to: object, key: string, status: string }[] }
   */
  const links = []

  const checkNeighbour = (node, key, expected) => {
    const neighbour = node[key]

    if (!neighbour?.url) {
      return report(node, `pas de ${names[key]}`)
    }

    const dead = deadByUrl.get(neighbour.url)

    if (dead) {
      report(node, `son ${names[key]} ${shortUrl(neighbour.url)} est injoignable`)
      if (isPosition(dead.id)) {
        links.push({ from: node, to: dead, key, status: 'dead' })
      }
      return
    }

    const target = byUrl.get(neighbour.url)

    if (!target) {
      return report(node, `son ${names[key]} ${shortUrl(neighbour.url)} répond, mais annonce une autre URL`)
    }

    // Déjà signalé : identifiant non calculé ou taille différente
    if (!placedUrls.has(target.url)) {
      return
    }

    let ok = true

    if (neighbour.id !== target.id) {
      ok = false
      report(node, `annonce son ${names[key]} ${shortUrl(target.url)} avec l'id ${JSON.stringify(neighbour.id)}, mais ce nœud a l'id ${target.id}`)
    }

    // Avec des collisions, l'ordre attendu est ambigu
    if (collisions.length === 0 && target !== expected) {
      ok = false
      report(node, `son ${names[key]} devrait être ${label(expected)}, pas ${label(target)}`)
    }

    const back = target[reverse[key]]?.url

    if (back !== node.url) {
      ok = false
      report(node, `a pour ${names[key]} ${label(target)}, mais celui-ci a pour ${names[reverse[key]]} ${back ? shortUrl(back) : 'personne'}`)
    }

    links.push({ from: node, to: target, key, status: ok ? 'ok' : 'error' })
  }

  for (const [i, node] of sorted.entries()) {
    checkNeighbour(node, 'successor', sorted[(i + 1) % sorted.length])
    checkNeighbour(node, 'predecessor', sorted[(i - 1 + sorted.length) % sorted.length])
  }

  // En suivant les successeurs, on doit faire le tour complet
  if (sorted.length > 1) {
    const start = sorted[0]
    const seen = new Set()
    let current = start

    while (current && !seen.has(current)) {
      seen.add(current)
      const next = current.successor?.url
      current = placedUrls.has(next) ? byUrl.get(next) : undefined
    }

    if (seen.size < sorted.length) {
      problems.unshift({
        urls: [start.url],
        text: `En suivant les successeurs depuis ${label(start)}, on ne parcourt que ${seen.size} nœud(s) sur ${sorted.length}`,
      })
    } else if (current !== start) {
      problems.unshift({
        urls: [start.url],
        text: `En suivant les successeurs depuis ${label(start)}, on ne revient pas au point de départ`,
      })
    }
  }

  // Responsable d'un identifiant, nœuds injoignables compris
  const ring = [...sorted, ...deadPlaced].sort((a, b) => a.id - b.id)
  const responsible = id => ring.find(node => node.id >= id) ?? ring[0]

  return {
    entryPoint,
    size,
    nbPoints,
    sorted,
    unplaced,
    deadNodes,
    deadPlaced,
    colors,
    byId,
    links,
    problems,
    responsible,
    /** @type { Map<string, string[]> } */
    keysByUrl: new Map(),
    /** @type { { key: string, holders: object[], id?: number, owner?: object, status?: string }[] } */
    keys: [],
    /** @type { { urls: string[], text: string }[] } */
    keyProblems: [],
  }
}

// Vérifie les identifiants des nœuds, puis récupère les clefs de chaque nœud
// et vérifie qu'elles sont chez leur responsable
async function analyseKeys (analysis) {
  const { sorted, size, responsible, keysByUrl, keyProblems } = analysis
  const lists = await Promise.all(sorted.map(node => fetchJson(`${node.url}/keys`)))
  const keys = new Map()

  for (const [i, node] of sorted.entries()) {
    const list = Array.isArray(lists[i]) ? lists[i].map(String) : []
    keysByUrl.set(node.url, list)

    for (const key of list) {
      if (!keys.has(key)) {
        keys.set(key, { key, holders: [] })
      }
      keys.get(key).holders.push(node)
    }
  }

  analysis.keys = [...keys.values()]

  if (!canHash || sorted.length === 0) {
    return
  }

  // L'identifiant d'un nœud est le hash de son URL
  for (const node of sorted) {
    const id = await getIdFromString(node.url, size)
    if (node.id !== id) {
      analysis.problems.push({ urls: [node.url], text: `${label(node)} : son identifiant devrait être le hash de son URL, soit ${id}` })
    }
  }

  for (const entry of analysis.keys) {
    entry.id = await getIdFromString(entry.key, size)
    entry.owner = responsible(entry.id)

    const name = `« ${entry.key} » (id ${entry.id})`

    if (entry.owner.dead) {
      entry.status = 'lost'
      keyProblems.push({ urls: [entry.owner.url], text: `${name} : son responsable ${label(entry.owner)} est injoignable` })
    } else if (!entry.holders.includes(entry.owner)) {
      entry.status = 'missing'
      keyProblems.push({
        urls: [entry.owner.url],
        text: `${name} devrait être sur ${label(entry.owner)}, qui ne l'a pas (présente sur ${entry.holders.map(node => shortUrl(node.url)).join(', ')})`,
      })
    } else {
      entry.status = 'ok'
    }
  }
}

// Dessin de l'anneau

function drawRing () {
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI)
  ctx.stroke()
}

function drawSmallCircle (x, y, color, size = nodeSize) {
  ctx.beginPath()
  ctx.arc(x, y, size, 0, 2 * Math.PI)
  ctx.fillStyle = color
  ctx.fill()
}

function drawOutline (id, color, gap = 5, width = 3) {
  const { x, y } = position(id)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, nodeSize + gap, 0, 2 * Math.PI)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
  ctx.restore()
}

function drawResponsibilities () {
  for (const [i, node] of state.sorted.entries()) {
    const predecessorId = node.predecessor?.id

    if (!Number.isInteger(predecessorId)) {
      continue
    }

    // Intervalle ]prédécesseur, nœud] : l'arc commence un peu après le prédécesseur
    // et finit un peu après le nœud. Le décalage vaut une position de l'anneau,
    // mais au moins 0,04 rad pour rester visible sur un grand anneau.
    const start = angleOf(predecessorId)
    const span = ((angleOf(node.id) - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI
    const shift = Math.min(Math.max(2 * Math.PI / state.nbPoints, 0.04), span / 0.8)

    ctx.save()
    ctx.beginPath()
    // Rayons alternés : deux intervalles qui se chevauchent restent visibles
    ctx.arc(center.x, center.y, responsibilityRadius - (i % 2) * 7, start + 0.7 * shift, start + span + 0.3 * shift)
    ctx.strokeStyle = state.colors.get(node.url)
    ctx.lineWidth = node.url === selectedUrl ? 6 : 3
    ctx.stroke()
    ctx.restore()
  }
}

function drawKeys () {
  for (const entry of state.keys) {
    if (entry.id === undefined) {
      continue
    }

    const { x, y } = position(entry.id, keyRadius)
    ctx.fillStyle = { ok: state.colors.get(entry.owner.url), missing: 'red', lost: 'grey' }[entry.status]
    ctx.fillRect(x - 4, y - 4, 8, 8)
  }
}

function moveTowards (from, to, distance) {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return {
    x: from.x + (to.x - from.x) * distance / length,
    y: from.y + (to.y - from.y) * distance / length,
  }
}

function drawArrow (fromId, toId, color, width, dashed) {
  const a = position(fromId)
  const b = position(toId)
  const dx = b.x - a.x
  const dy = b.y - a.y

  // Même position : lien vers soi-même ou collision
  if (Math.hypot(dx, dy) < 2 * nodeSize + 4) {
    return
  }

  // Courbe vers la droite du trajet, pour que A → B et B → A ne se superposent pas
  const control = { x: (a.x + b.x) / 2 - dy * 0.15, y: (a.y + b.y) / 2 + dx * 0.15 }
  const start = moveTowards(a, control, nodeSize + 2)
  const end = moveTowards(b, control, nodeSize + 4)
  const angle = Math.atan2(end.y - control.y, end.x - control.x)

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dashed ? [6, 5] : [])
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
  ctx.stroke()

  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(end.x - 10 * Math.cos(angle - 0.4), end.y - 10 * Math.sin(angle - 0.4))
  ctx.lineTo(end.x - 10 * Math.cos(angle + 0.4), end.y - 10 * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawLinks () {
  for (const link of state.links) {
    const bonus = link.from.url === selectedUrl ? 1.5 : 0

    if (link.key === 'successor') {
      const color = { ok: '#999', error: 'red', dead: 'grey' }[link.status]
      drawArrow(link.from.id, link.to.id, color, (link.status === 'error' ? 2.5 : 1.5) + bonus, link.status === 'dead')
    } else if (link.status === 'error') {
      drawArrow(link.from.id, link.to.id, 'orange', 2 + bonus, true)
    }
  }
}

// Place les étiquettes autour de l'anneau. Dans une grappe de nœuds proches,
// elles s'écartent le long du cercle juste assez pour ne pas se chevaucher.
function placeLabels (labels) {
  const items = [...labels].sort((a, b) => a.id - b.id)
  const height = parseInt(ctx.font)

  for (const item of items) {
    item.width = ctx.measureText(item.text).width
    item.angle = angleOf(item.id)
  }

  // Écart minimal, en radians, entre deux étiquettes voisines : en haut et en bas
  // elles sont côte à côte (largeur), sur les côtés l'une au-dessus de l'autre (hauteur)
  const minGap = (a, b) => {
    const middle = (a.angle + b.angle) / 2
    const across = (a.width + b.width) / 2 + 6
    const along = height + 2
    const needed = Math.min(across / Math.max(Math.abs(Math.sin(middle)), 0.01), along / Math.max(Math.abs(Math.cos(middle)), 0.01))
    return needed / textRadius
  }

  // Relaxation : on écarte les paires trop proches, en gardant l'ordre de l'anneau
  for (let iteration = 0; iteration < 200 && items.length > 1; iteration++) {
    let moved = false

    for (let i = 0; i < items.length; i++) {
      const a = items[i]
      const b = items[(i + 1) % items.length]
      const gap = i === items.length - 1 ? b.angle + 2 * Math.PI - a.angle : b.angle - a.angle
      const deficit = minGap(a, b) - gap

      if (deficit > 0.0001) {
        a.angle -= deficit / 2
        b.angle += deficit / 2
        moved = true
      }
    }

    if (!moved) {
      break
    }
  }

  for (const item of items) {
    item.x = Math.min(Math.max(center.x + textRadius * Math.cos(item.angle), item.width / 2 + 2), canvasSize - item.width / 2 - 2)
    item.y = Math.min(Math.max(center.y + textRadius * Math.sin(item.angle), height / 2 + 2), canvasSize - height / 2 - 2)
    item.moved = Math.abs(item.angle - angleOf(item.id)) * textRadius > 4
  }

  return items
}

function drawNodes () {
  ctx.save()
  // Police plus petite pour les identifiants longs d'un grand anneau
  ctx.font = state.nbPoints > 1000 ? '15px Arial' : '20px Arial'

  const labels = []

  for (const node of state.deadPlaced) {
    const { x, y } = position(node.id)
    drawSmallCircle(x, y, 'lightgrey')
    labels.push({ id: node.id, text: `${node.id} ✝`, color: 'grey' })
  }

  for (const [id, group] of state.byId) {
    const { x, y } = position(id)
    const collision = group.length > 1

    if (group.some(isNew)) {
      drawOutline(id, 'gold', 9, 5)
    }

    drawSmallCircle(x, y, collision ? 'red' : state.colors.get(group[0].url))
    labels.push({ id, text: collision ? `${id} ×${group.length}` : `${id}`, color: collision ? 'red' : 'black' })

    if (group.some(node => node.url === selectedUrl)) {
      drawOutline(id, 'black')
    }
  }

  for (const item of placeLabels(labels)) {
    // Trait de rappel vers le nœud pour une étiquette déplacée
    if (item.moved) {
      const from = position(item.id, radius + nodeSize + 1)
      ctx.strokeStyle = '#aaa'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(center.x + (textRadius - 12) * Math.cos(item.angle), center.y + (textRadius - 12) * Math.sin(item.angle))
      ctx.stroke()
    }
    ctx.fillStyle = item.color
    ctx.fillText(item.text, item.x, item.y)
  }

  ctx.restore()
}

function drawLookup () {
  if (!lookup) {
    return
  }

  const { x, y } = position(lookup.id, keyRadius)
  const text = position(lookup.id, keyRadius - 50)

  ctx.save()
  ctx.strokeStyle = 'purple'
  ctx.fillStyle = 'purple'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(x, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(x, y - 8)
  ctx.lineTo(x + 8, y)
  ctx.lineTo(x, y + 8)
  ctx.lineTo(x - 8, y)
  ctx.closePath()
  ctx.fill()
  ctx.font = '16px Arial'
  ctx.fillText(`« ${lookup.key} »`, text.x, text.y)
  ctx.restore()

  drawOutline(lookup.expected.id, 'green')

  const actual = state.sorted.find(node => node.url === lookup.actual)
  if (actual && actual !== lookup.expected) {
    drawOutline(actual.id, 'red')
  }
}

// Adapte la résolution du canvas à l'écran (Retina, zoom du navigateur) pour un dessin net
function fitCanvas () {
  const ratio = window.devicePixelRatio || 1
  const size = Math.round(canvasSize * ratio)

  if (canvas.width !== size) {
    canvas.width = size
    canvas.height = size
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
}

function render () {
  fitCanvas()
  ctx.clearRect(0, 0, canvasSize, canvasSize)
  drawRing()

  if (!state || (state.sorted.length === 0 && state.deadPlaced.length === 0)) {
    return
  }

  nodeSize = state.sorted.length + state.deadPlaced.length > 16 ? 10 : 15

  drawResponsibilities()
  drawKeys()
  drawLinks()
  drawNodes()
  drawLookup()
}

// Panneau de droite

function select (url) {
  selectedUrl = selectedUrl === url ? null : url
  render()
  renderPanel()
}

function problemsOf (url) {
  return [...state.problems, ...state.keyProblems].filter(problem => problem.urls.includes(url))
}

function appendProblems (title, problems) {
  if (problems.length === 0) {
    return
  }

  const list = el('ul')

  for (const problem of problems.slice(0, maxListed)) {
    const item = el('li', problem.text)
    item.addEventListener('click', () => select(problem.urls[0]))
    list.append(item)
  }

  if (problems.length > maxListed) {
    list.append(el('li', `… et ${problems.length - maxListed} autre(s)`))
  }

  problemsEl.append(el('h3', title), list)
}

function neighbourCell (neighbour) {
  const cell = el('td', neighbour ? (Number.isInteger(neighbour.id) ? String(neighbour.id) : '?') : '')
  cell.title = neighbour ? `${neighbour.url} (id ${JSON.stringify(neighbour.id)})` : ''
  return cell
}

function keysCell (node) {
  const cell = el('td')

  for (const [i, key] of (state.keysByUrl.get(node.url) ?? []).entries()) {
    const entry = state.keys.find(entry => entry.key === key)
    // Une clef dont le nœud n'est pas responsable est une copie (cf. question 1)
    const copy = entry?.owner && entry.owner !== node
    if (i > 0) {
      cell.append(', ')
    }
    const span = el('span', key, copy ? 'copy' : undefined)
    if (copy) {
      span.title = `copie : le responsable est ${label(entry.owner)}`
    }
    cell.append(span)
  }

  return cell
}

function addRow (node, cells, className) {
  const row = el('tr')
  row.className = [className, node.url === selectedUrl ? 'selected' : ''].join(' ').trim()
  row.append(...cells)
  row.addEventListener('click', () => select(node.url))
  nodesEl.append(row)
}

function stateCell (node) {
  const count = problemsOf(node.url).length
  return count === 0 ? el('td', '✓', 'ok') : el('td', `⚠ ${count}`, 'error')
}

function renderTable () {
  for (const node of state.sorted) {
    const swatch = el('td')
    swatch.append(el('span', '', 'swatch'))
    // @ts-ignore
    swatch.firstChild.style.background = state.colors.get(node.url)
    const urlCell = el('td', shortUrl(node.url))
    if (isNew(node)) {
      urlCell.append(el('span', 'nouveau', 'new'))
    }
    addRow(node, [
      swatch,
      el('td', String(node.id)),
      urlCell,
      neighbourCell(node.predecessor),
      neighbourCell(node.successor),
      keysCell(node),
      stateCell(node),
    ])
  }

  for (const node of state.unplaced) {
    addRow(node, [
      el('td'),
      el('td', '?'),
      el('td', shortUrl(node.url)),
      neighbourCell(node.predecessor),
      neighbourCell(node.successor),
      el('td'),
      stateCell(node),
    ])
  }

  for (const node of state.deadNodes) {
    addRow(node, [
      el('td'),
      el('td', Number.isInteger(node.id) ? String(node.id) : '?'),
      el('td', shortUrl(node.url)),
      el('td'),
      el('td'),
      el('td'),
      el('td', 'injoignable'),
    ], 'dead')
  }
}

function renderDetails () {
  if (!selectedUrl) {
    return
  }

  const dead = state.deadNodes.find(node => node.url === selectedUrl)

  if (dead) {
    detailsEl.append(el('h3', label(dead)), el('p', 'Ce nœud est cité comme voisin, mais ne répond pas.'))
    return
  }

  const node = [...state.sorted, ...state.unplaced].find(node => node.url === selectedUrl)

  if (!node) {
    return
  }

  detailsEl.append(el('h3', label(node)))

  const problems = problemsOf(node.url)
  if (problems.length > 0) {
    const list = el('ul')
    list.append(...problems.map(problem => el('li', problem.text, 'error')))
    detailsEl.append(list)
  }

  detailsEl.append(el('pre', JSON.stringify(node, null, 2)))
}

function renderPanel () {
  summaryEl.replaceChildren()
  problemsEl.replaceChildren()
  nodesEl.replaceChildren()
  detailsEl.replaceChildren()

  if (!state) {
    return
  }

  const total = state.problems.length + state.keyProblems.length

  if (total === 0) {
    summaryEl.className = 'ok'
    summaryEl.textContent = `✓ Anneau cohérent : ${state.sorted.length} nœud(s), ${state.keys.length} clef(s)`
  } else {
    summaryEl.className = 'error'
    summaryEl.textContent = `✗ ${total} problème(s) détecté(s)`
  }

  if (!canHash) {
    problemsEl.append(el('p', 'Position des clefs indisponible : ouvrez le viewer via http://localhost pour pouvoir les hacher.'))
  }

  appendProblems('Anneau', state.problems)
  appendProblems('Clefs', state.keyProblems)
  renderTable()
  renderDetails()
}

function renderLookup () {
  lookupResultEl.className = ''

  if (!lookup) {
    lookupResultEl.textContent = ''
    return
  }

  const name = `« ${lookup.key} » (id ${lookup.id})`
  const expected = `${label(lookup.expected)}${lookup.expected.dead ? ', injoignable' : ''}`

  if (lookup.pending) {
    lookupResultEl.textContent = `lookup ${name} en cours, responsable attendu : ${expected}`
  } else if (lookup.error) {
    lookupResultEl.className = 'error'
    lookupResultEl.textContent = `✗ lookup ${name} : ${lookup.error}. Responsable attendu : ${expected}`
  } else if (lookup.actual === lookup.expected.url) {
    lookupResultEl.className = 'ok'
    lookupResultEl.textContent = `✓ lookup ${name} → ${shortUrl(lookup.actual)}, c'est bien le responsable`
  } else {
    lookupResultEl.className = 'error'
    lookupResultEl.textContent = `✗ lookup ${name} → ${JSON.stringify(lookup.actual)}, attendu ${expected}`
  }
}

// Info-bulle au survol

function hitTest (event) {
  if (!state) {
    return null
  }

  const rect = canvas.getBoundingClientRect()
  const point = {
    x: (event.clientX - rect.left) * canvasSize / rect.width,
    y: (event.clientY - rect.top) * canvasSize / rect.height,
  }
  const near = (id, r, distance) => {
    const { x, y } = position(id, r)
    return Math.hypot(x - point.x, y - point.y) <= distance
  }

  const nodes = [...state.sorted, ...state.deadPlaced].filter(node => near(node.id, radius, nodeSize + 3))
  if (nodes.length > 0) {
    return { nodes }
  }

  const keys = state.keys.filter(entry => entry.id !== undefined && near(entry.id, keyRadius, 7))
  if (keys.length > 0) {
    return { keys }
  }

  return null
}

function describeNode (node) {
  if (node.dead) {
    return `${label(node)} : injoignable`
  }

  return [
    label(node),
    `responsable de ]${node.predecessor?.id}, ${node.id}]`,
    `prédécesseur : ${node.predecessor?.url ? shortUrl(node.predecessor.url) : 'aucun'}`,
    `successeur : ${node.successor?.url ? shortUrl(node.successor.url) : 'aucun'}`,
    `clefs : ${(state.keysByUrl.get(node.url) ?? []).join(', ') || 'aucune'}`,
  ].join('\n')
}

function describeKey (entry) {
  const status = {
    ok: '✓ présente chez son responsable',
    missing: '✗ absente de chez son responsable',
    lost: '✗ responsable injoignable',
  }[entry.status]

  return [
    `« ${entry.key} » (id ${entry.id})`,
    `responsable : ${label(entry.owner)}`,
    `présente sur : ${entry.holders.map(node => shortUrl(node.url)).join(', ')}`,
    status,
  ].join('\n')
}

canvas.addEventListener('mousemove', event => {
  const hit = hitTest(event)

  if (!hit) {
    tooltip.style.display = 'none'
    canvas.style.cursor = ''
    return
  }

  tooltip.textContent = hit.nodes ? hit.nodes.map(describeNode).join('\n\n') : hit.keys.map(describeKey).join('\n\n')
  tooltip.style.display = 'block'
  const container = tooltip.parentElement.getBoundingClientRect()
  tooltip.style.left = `${event.clientX - container.left + 14}px`
  tooltip.style.top = `${event.clientY - container.top + 14}px`
  canvas.style.cursor = hit.nodes ? 'pointer' : ''
})

canvas.addEventListener('mouseleave', () => {
  tooltip.style.display = 'none'
})

canvas.addEventListener('click', event => {
  const hit = hitTest(event)

  if (hit?.nodes) {
    select(hit.nodes[0].url)
  } else if (selectedUrl) {
    select(selectedUrl)
  }
})

// Commandes

// Reflète le point d'entrée et l'actualisation dans l'adresse, pour la partager ou la garder en favori
function updateAddress () {
  const params = new URLSearchParams()

  if (currentEntry) {
    params.set('node', currentEntry)
  }

  if (refreshSelect.value !== '0') {
    params.set('refresh', refreshSelect.value)
  }

  history.replaceState(null, '', `?${params}`)
}

function scheduleRefresh () {
  clearTimeout(refreshTimer)

  const seconds = Number(refreshSelect.value)

  if (seconds > 0 && currentEntry) {
    refreshTimer = setTimeout(() => display(currentEntry), seconds * 1000)
  }
}

// Affiche l'anneau du point d'entrée saisi
function show () {
  const entryPoint = entryInput.value.trim().replace(/\/+$/, '')

  try {
    localStorage.setItem('entryPoint', entryPoint)
  } catch {}

  return display(entryPoint)
}

async function display (entryPoint) {
  const run = ++generation
  // Réafficher le même anneau, à la main ou par l'actualisation, ne fait pas clignoter la page
  const sameRing = state?.entryPoint === entryPoint

  clearTimeout(refreshTimer)
  currentEntry = entryPoint
  updateAddress()

  if (!sameRing) {
    firstSeen.clear()
    showButton.disabled = true
    statusEl.textContent = 'Exploration de l\'anneau…'
  }

  try {
    const data = await exploreDht(entryPoint)
    let analysis = null

    if (data.nodes.length > 0) {
      analysis = analyse(data)
      await analyseKeys(analysis)
    }

    if (run !== generation) {
      return
    }

    // Les nœuds présents au premier affichage ne sont pas « nouveaux »
    const now = sameRing ? Date.now() : 0
    for (const node of analysis?.sorted ?? []) {
      if (!firstSeen.has(node.url)) {
        firstSeen.set(node.url, now)
      }
    }

    // Un test de lookup terminé reste affiché, avec le responsable attendu dans le nouvel anneau
    if (!sameRing || !analysis?.sorted.length) {
      lookup = null
    } else if (lookup && !lookup.pending) {
      lookup.expected = analysis.responsible(lookup.id)
    }

    state = analysis
    renderLookup()
    render()
    renderPanel()
    statusEl.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`

    if (!state) {
      summaryEl.className = 'error'
      summaryEl.textContent = `${entryPoint} est injoignable`
    }
  } finally {
    if (run === generation) {
      showButton.disabled = false
      scheduleRefresh()
    }
  }
}

async function testLookup () {
  const key = lookupInput.value

  if (!state || state.sorted.length === 0 || !key) {
    return
  }

  if (!canHash) {
    lookupResultEl.className = 'error'
    lookupResultEl.textContent = 'Impossible de hacher la clef : ouvrez le viewer via http://localhost'
    return
  }

  const id = await getIdFromString(key, state.size)
  const current = { key, id, expected: state.responsible(id), pending: true }
  lookup = current
  render()
  renderLookup()

  try {
    const response = await fetch(`${state.entryPoint}/lookup/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) })
    const body = await response.text()
    let value = body
    try {
      value = JSON.parse(body)
    } catch {}

    if (response.ok) {
      current.actual = value
    } else {
      current.error = `HTTP ${response.status} : ${typeof value === 'string' ? value : body}`
    }
  } catch (error) {
    current.error = error.name === 'TimeoutError' ? 'pas de réponse après 10 s' : 'point d\'entrée injoignable'
  }

  current.pending = false

  // Un autre test ou une nouvelle exploration a eu lieu entre-temps
  if (lookup !== current) {
    return
  }

  render()
  renderLookup()
}

showButton.addEventListener('click', show)
document.getElementById('lookup').addEventListener('click', testLookup)
entryInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    show()
  }
})
lookupInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    testLookup()
  }
})
refreshSelect.addEventListener('change', () => {
  updateAddress()
  scheduleRefresh()
})
// Le zoom ou le passage sur un autre écran change la densité de pixels
window.addEventListener('resize', render)

// Point d'entrée : ?node=… dans l'adresse, sinon le dernier utilisé
const params = new URLSearchParams(location.search)
const nodeParam = params.get('node')

try {
  entryInput.value = nodeParam ?? localStorage.getItem('entryPoint') ?? entryInput.value
} catch {
  entryInput.value = nodeParam ?? entryInput.value
}

// Actualisation : ?refresh=5 dans l'adresse, par exemple pour le vidéoprojecteur
if ([...refreshSelect.options].some(option => option.value === params.get('refresh'))) {
  refreshSelect.value = params.get('refresh')
}

render()

if (nodeParam) {
  show()
}
