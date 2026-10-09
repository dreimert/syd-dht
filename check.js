#!/usr/bin/env node

// Vérifie votre implémentation niveau par niveau : npm run check
// Lance ses propres nœuds sur les ports 5100 et suivants, vos nœuds PM2 ne sont pas touchés.

import { spawn } from 'child_process'
import crypto from 'crypto'
import net from 'net'

const file = process.argv[2] ?? 'index.js'
const size = 6
const timeout = 5000

// Mêmes fonctions que dans index.js, pour calculer les résultats attendus
function getIdFromString(data, m = size) {
  const buffer = crypto.createHash('sha1').update(data, 'utf8').digest()
  const bitString = Array.from(buffer).map(byte => byte.toString(2).padStart(8, '0')).join('').slice(-m)
  return parseInt(bitString, 2)
}

// Choix de ports dont les identifiants sont tous différents
const nodes = []
for (let port = 5100; nodes.length < 4; port++) {
  const url = `http://localhost:${port}`
  const id = getIdFromString(url)
  if (!nodes.some(node => node.id === id)) {
    nodes.push({ port, url, id })
  }
}
const [A, B, C, D] = nodes

const name = node => `${node.port} (id ${node.id})`

// Nœud responsable d'un identifiant parmi une liste de nœuds
function responsible(ring, id) {
  const sorted = [...ring].sort((a, b) => a.id - b.id)
  return sorted.find(node => node.id >= id) ?? sorted[0]
}

// Des clefs de test, avec au moins une clef par intervalle de l'anneau à quatre nœuds
const keys = ['Bob', 'Alice', 'Heidi', 'Carol', 'Dave', 'Eve']
for (const node of nodes) {
  for (let i = 0; !keys.some(key => responsible(nodes, getIdFromString(key)) === node); i++) {
    if (responsible(nodes, getIdFromString(`clef${i}`)) === node) {
      keys.push(`clef${i}`)
    }
  }
}

// Gestion des nœuds lancés par le vérificateur
const processes = new Map()

function portIsFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })
}

async function start(node) {
  // Sinon, c'est le nœud déjà présent sur le port qui serait testé
  if (!await portIsFree(node.port)) {
    throw new Error(`le port ${node.port} est déjà utilisé (un nœud d'une vérification précédente ?)`)
  }

  const child = spawn(process.execPath, [file, '--port', node.port, '--size', size])
  const proc = { child, logs: [], exited: false }
  const log = data => proc.logs.push(...data.toString().trimEnd().split('\n'))
  child.stdout.on('data', log)
  child.stderr.on('data', log)
  child.on('exit', () => { proc.exited = true })
  processes.set(node, proc)

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (proc.exited) {
      throw new Error(`le nœud ${node.port} s'est arrêté au démarrage`)
    }
    try {
      await fetch(`${node.url}/`, { signal: AbortSignal.timeout(500) })
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error(`le nœud ${node.port} ne répond pas après ${timeout / 1000} s`)
}

async function stopAll() {
  await Promise.all([...processes.values()].map(proc => new Promise(resolve => {
    if (proc.exited) return resolve()
    proc.child.once('exit', resolve)
    proc.child.kill()
  })))
  processes.clear()
}

process.on('exit', () => {
  for (const proc of processes.values()) proc.child.kill()
})
// Ctrl+C ou arrêt par l'éditeur : on passe par 'exit' pour arrêter les nœuds
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

// Requête HTTP vers un nœud, renvoie { status, body }
async function call(method, url, body) {
  let response
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    throw new Error(`${method} ${url} : pas de réponse en ${timeout / 1000} s`)
  }
  const text = await response.text()
  try {
    return { status: response.status, body: JSON.parse(text) }
  } catch {
    return { status: response.status, body: text }
  }
}

async function json(method, url, body) {
  const { status, body: result } = await call(method, url, body)
  if (status !== 200) {
    throw new Error(`${method} ${url} : erreur ${status} ${JSON.stringify(result)}`)
  }
  return result
}

function expect(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} : attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`)
  }
}

function neighbour(config, key) {
  return { id: config[key]?.id, url: config[key]?.url }
}

// Vérifie que successeurs et prédécesseurs forment l'anneau trié des nœuds
async function checkRing(ring) {
  const sorted = [...ring].sort((a, b) => a.id - b.id)
  for (const [i, node] of sorted.entries()) {
    const config = await json('GET', `${node.url}/config`)
    const successor = sorted[(i + 1) % sorted.length]
    const predecessor = sorted[(i - 1 + sorted.length) % sorted.length]
    expect(neighbour(config, 'successor'), { id: successor.id, url: successor.url }, `successeur de ${name(node)}`)
    expect(neighbour(config, 'predecessor'), { id: predecessor.id, url: predecessor.url }, `prédécesseur de ${name(node)}`)
  }
}

// Vérifie que chaque nœud stocke ses clefs et que toutes les clefs sont lisibles depuis n'importe quel nœud
async function checkKeys(ring, stored) {
  for (const node of ring) {
    const nodeKeys = await json('GET', `${node.url}/keys`)
    for (const key of stored) {
      const owner = responsible(ring, getIdFromString(key))
      if (owner === node && !nodeKeys.includes(key)) {
        throw new Error(`la clef ${key} (id ${getIdFromString(key)}) devrait être stockée sur ${name(node)}, qui a ${JSON.stringify(nodeKeys)}`)
      }
    }
  }
  for (const node of ring) {
    for (const key of stored) {
      expect(await json('GET', `${node.url}/db/${key}`), `valeur de ${key}`, `get ${key} depuis ${node.port}`)
    }
  }
}

async function twoNodeRing() {
  await start(A)
  await start(B)
  await json('POST', `${B.url}/join`, { url: A.url })
}

const levels = [
  {
    name: 'Identifiant',
    async run() {
      await start(A)
      const config = await json('GET', `${A.url}/config`)
      expect(config.id, A.id, `id de ${A.url}`)
      expect(neighbour(config, 'successor'), { id: A.id, url: A.url }, `successeur d'un nœud seul`)
      expect(neighbour(config, 'predecessor'), { id: A.id, url: A.url }, `prédécesseur d'un nœud seul`)
    },
  },
  {
    name: 'add',
    async run() {
      await start(A)
      await json('POST', `${A.url}/add`, { url: B.url })
      const config = await json('GET', `${A.url}/config`)
      expect(neighbour(config, 'successor'), { id: B.id, url: B.url }, `successeur de ${name(A)} après add ${B.port}`)
      expect(neighbour(config, 'predecessor'), { id: B.id, url: B.url }, `prédécesseur de ${name(A)} après add ${B.port}`)
    },
  },
  {
    name: 'join à deux nœuds',
    async run() {
      await twoNodeRing()
      await checkRing([A, B])
    },
  },
  {
    name: 'lookup',
    async run() {
      await twoNodeRing()
      for (const node of [A, B]) {
        for (const key of keys) {
          const owner = responsible([A, B], getIdFromString(key))
          expect(await json('GET', `${node.url}/lookup/${key}`), owner.url, `lookup ${key} (id ${getIdFromString(key)}) depuis ${node.port}`)
        }
      }
    },
  },
  {
    name: 'get et put',
    async run() {
      await twoNodeRing()
      for (const [i, key] of keys.entries()) {
        await json('PUT', `${[A, B][i % 2].url}/db/${key}`, { value: `valeur de ${key}` })
      }
      await checkKeys([A, B], keys)
      for (const node of [A, B]) {
        const { status } = await call('GET', `${node.url}/db/inexistante`)
        expect(status, 404, `get d'une clef inexistante depuis ${node.port}`)
      }
    },
  },
  {
    name: 'join à plusieurs nœuds',
    async run() {
      await twoNodeRing()
      for (const key of keys) {
        await json('PUT', `${A.url}/db/${key}`, { value: `valeur de ${key}` })
      }
      await start(C)
      await json('POST', `${C.url}/join`, { url: A.url })
      await checkRing([A, B, C])
      await checkKeys([A, B, C], keys)
      await start(D)
      await json('POST', `${D.url}/join`, { url: B.url })
      await checkRing([A, B, C, D])
      await checkKeys([A, B, C, D], keys)
    },
  },
]

console.log(`Vérification de ${file} avec les nœuds ${nodes.map(name).join(', ')}\n`)

let failed = false
for (const [i, level] of levels.entries()) {
  const label = `Niv. ${i + 1}  ${level.name}`
  if (failed) {
    console.log(`🔒 ${label}`)
    continue
  }
  try {
    await level.run()
    console.log(`✅ ${label}`)
  } catch (error) {
    failed = true
    console.log(`❌ ${label}\n   ${error.message}`)
    for (const [node, proc] of processes) {
      console.log(`\n   Dernières lignes du nœud ${name(node)} :`)
      for (const line of proc.logs.slice(-8)) console.log(`   | ${line}`)
    }
    console.log()
  }
  await stopAll()
}

if (!failed) {
  console.log(`\nTous les niveaux sont validés. Vous pouvez rejoindre l'anneau de la promo !`)
}
process.exit(failed ? 1 : 0)
