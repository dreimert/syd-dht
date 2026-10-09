#!/usr/bin/env node

import express from 'express'
import cors from 'cors'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import crypto from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import baseGot from 'got'

// Gestion des options
const argv = yargs(hideBin(process.argv))
  .options({
    port: {
      description: "Port d'écoute du nœud",
      alias: 'p',
      default: 4000,
    },
  })
  .options({
    size: {
      description: "Fixe l'exposant de l'anneau",
      alias: 'm',
      default: 6,
    },
  })
  .options({
    host: {
      description: "Adresse du nœud vue par les autres (votre IP pour un anneau entre plusieurs machines)",
      alias: 'H',
      default: 'localhost',
    },
  })
  .options({
    hops: {
      description: "Nombre maximum de sauts d'une requête avant de l'abandonner",
      default: 64,
    },
  })
  .parse()

// Initialisation de la base de données
const db = {
  test: "Hello World!", // Exemple d'initialisation, permet les premiers tests
}

// Préparation de l'URL du nœud
// @ts-ignore
const size = argv.size
// @ts-ignore
const port = argv.port
// @ts-ignore
const host = argv.host
// @ts-ignore
const maxHops = argv.hops
const url = `http://${host}:${port}`
const id = 'Voir : Prenons un peu de <i>hash</i>'

// Initialisation de la configuration du nœud
const config = {
  port,
  url,
  id,
  size,
  successor: {
    id,
    url,
  },
  predecessor: {
    id,
    url,
  },
}

/**
 * Exemple de fonction qui prend une chaîne de caractères et produit un hash sous forme d'une chaîne hexadécimale
 *
 * @param {string} data la chaine de caractère à hasher
 *
 * @returns {string} le hash en hexadécimal
 **/
function getHash(data) {
  return crypto.createHash('sha1').update(data, 'utf8').digest('hex');
}

// Je vous donne la fonction, elle est un peu compliquée ;)
/**
 * Convertit la clef vers un identifiant sur l'anneau de taille 2^m
 *
 * @param {string} data la chaine de caractère à hasher
 *
 * @returns {number} l'identifiant sur l'anneau
 **/
function getIdFromString(data, m = size) {
  // Calcul du hash et conversion en un buffer
  const buffer = crypto.createHash('sha1').update(data, 'utf8').digest()
  // Conversion du buffer en une chaine de m bits
  const bitString = Array.from(buffer).map(byte => byte.toString(2).padStart(8, '0')).join('').slice(-m)
  // Conversion de la chaine de bits en un entier
  return parseInt(bitString, 2)
}

// Je vous donne la fonction, elle est un peu compliquée aussi ;)
/**
 * Indique si un identifiant est dans l'intervalle de responsabilité du nœud, soit ]start, end]
 *
 * @param {number} id l'identifiant à tester
 * @param {number} start le début de l'intervalle (exclu)
 * @param {number} end la fin de l'intervalle (inclus)
 *
 * @returns {boolean} vrai si l'identifiant est dans l'intervalle
 **/
function idIsInInterval(id, start = config.predecessor.id, end = config.id) {
  if (start < end) {
    return id > start && id <= end
  } else {
    return id > start || id <= end
  }
}

// Protection contre les boucles, vous n'avez pas à y toucher.
// Si l'anneau est cassé, une requête peut tourner indéfiniment de nœud en nœud.
// Chaque requête transmise par `got` porte donc un compteur de sauts (en-tête x-hops)
// et un nœud refuse une requête qui a fait plus de `--hops` sauts.
const hops = new AsyncLocalStorage()

const got = baseGot.extend({
  timeout: { request: 10000 },
  retry: { limit: 0 },
  hooks: {
    beforeRequest: [
      options => {
        options.headers['x-hops'] = String((hops.getStore() ?? 0) + 1)
      },
    ],
  },
})

// Initialisation du serveur HTTP
const app = express()
// For viewer
app.use(cors());
// Pour parse les requêtes
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
// Comptage des sauts
app.use((req, res, next) => {
  const count = Number(req.get('x-hops') ?? 0)

  if (count > maxHops) {
    console.error(`Requête abandonnée après ${count} sauts`)
    return res.status(508).json(`Requête abandonnée après ${count} sauts : l'anneau boucle-t-il ?`)
  }

  hops.run(count, next)
})

// Route pour la racine, pour tester le serveur par exemple. Vous pouvez mettre ce que vous voulez ici.
app.get('/', (req, res) => {
  res.send('Hello World!')
})

// Routes pour les commandes du nœud

app.get('/db/:key', async (req, res) => {
  console.log('GET /db', req.params.key)

  if (!Object.hasOwn(db, req.params.key)) {
    return res.status(404).json(`Clef ${req.params.key} introuvable`)
  }

  res.json(db[req.params.key])
})

app.put('/db/:key', async (req, res) => {
  console.log('PUT /db', req.params.key, req.body.value)

  db[req.params.key] = req.body.value

  res.json(true)
})

app.get('/keys', (req, res) => {
  console.log('GET /keys')

  res.json(Object.keys(db))
})

app.get('/lookup/:key', async (req, res) => {
  console.log('GET /lookup', req.params.key)

  // getIdFromString et idIsInInterval peuvent vous être utiles ;)
  res.json('TODO')
})

app.get('/config/:key', (req, res) => {
  console.log('GET /config/', req.params.key)

  res.json(config[req.params.key])
})

app.get('/config', (req, res) => {
  console.log('GET /config')

  res.json(config)
})

app.post('/join', async (req, res) => {
  console.log('POST /join', req.body.url)

  // Cf. cli.js pour plus d'exemples
  // const res = await got.post({
  //   url: `${req.body.url}/add`,
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ url: config.url })
  // })

  res.json('TODO')
})

app.post('/add', (req, res) => {
  console.log('POST /add', req.body.url)

  res.json('TODO')
})

// Gestion des erreurs, vous n'avez pas à y toucher.
// Si une requête vers un autre nœud échoue, son code d'erreur (404, 508...) est renvoyé tel quel.
app.use((err, req, res, next) => {
  console.error(err.message)

  if (err.response) {
    return res
      .status(err.response.statusCode)
      .type(err.response.headers['content-type'] ?? 'json')
      .send(err.response.rawBody)
  }

  res.status(500).json(err.message)
})

// Lancement du serveur

console.log(`Server try run on port ${config.port}`)

app.listen(config.port, () => {
  console.log(`Listening on port ${config.port}`)
})
