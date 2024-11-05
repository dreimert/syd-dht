#!/usr/bin/env node

import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import crypto from 'crypto'
import got from 'got' // Utile pour faire des requêtes HTTP

// Gestion des options
const argv = yargs(hideBin(process.argv))
  .options({
    port: {
      description: "Port d'écoute du nœuds",
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
const url = `http://localhost:${port}`
const id = getIdFromString(url) // 'Voir : Prenons un peu de <i>hash</i>'

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
 * Exemple de function qui prend une chaine de caractère et produit un hash sous forme d'une chaine hexadécimal
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
 * Convertie la clef vers un identifiant sur l'anneau de taille 2^m
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
 * Indique si un identifiant est dans l'interval de responsabilité du nœud
 *
 * @param {number} id l'identifiant à tester
 * @param {number} start le début de l'intervalle
 * @param {number} end la fin de l'intervalle
 *
 * @returns {boolean} vrai si l'identifiant est dans l'intervalle
 **/
function idIsInInterval(id, start = config.predecessor.id + 1, end = config.id) {
  if (start < end) {
    return id > start && id <= end
  } else {
    return id > start || id <= end
  }
}

// Initialisation du serveur HTTP
const app = express()
// For viewer
app.use(cors());
// Pour parse les requêtes
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Route pour la racine, pour tester le serveur par exemple. Vous pouvez mettre ce que vous voulez ici.
app.get('/', (req, res) => {
  res.send('Hello World!')
})

// Routes pour les commandes du nœud

app.get('/db/:key', async (req, res) => {
  console.log('GET /db', req.params.key)

  const id = getIdFromString(req.params.key)

  if (idIsInInterval(id)) {
    res.json(db[req.params.key])
  } else {
    const value = await got(config.successor.url + '/db/' + req.params.key).json()
    res.json(value)
  }
})

app.put('/db/:key', async (req, res) => {
  console.log('PUT /db', req.params.key, req.body.value)

  const id = getIdFromString(req.params.key)

  if (idIsInInterval(id)) {
    db[req.params.key] = req.body.value
    res.json(config.url)
  } else {
    const url = await got.put({
      url: `${config.successor.url}/db/${req.params.key}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: req.body.value })
    }).json()

    res.json(url)
  }
})

app.get('/keys', (req, res) => {
  console.log('GET /keys')

  res.json(Object.keys(db))
})

app.get('/lookup/:id(\\d+)', async (req, res) => {
  console.log('GET /lookup', req.params.id)

  if (idIsInInterval(parseInt(req.params.id))) {
    res.json(config.url)
  } else {
    const url = await got(config.successor.url + '/lookup/' + req.params.id).json()
    res.json(url)
  }
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

  // V1 à deux noeuds

  // const add = await got.post({
  //   url: `${req.body.url}/add`,
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ url: config.url })
  // })

  // config.successor = {
  //   id: getIdFromString(req.body.url),
  //   url: req.body.url,
  // }
  // config.predecessor = {
  //   id: getIdFromString(req.body.url),
  //   url: req.body.url,
  // }

  // /**
  //  * @type string[]
  //  */
  // const keys = await got(`${req.body.url}/keys`).json()

  // console.info('Syncing keys')

  // for (const key of keys) {
  //   // TODO : filter only keys that are in the range of the new node
  //   console.log(key)
  //   const value = await got(`${req.body.url}/db/${key}`).json()
  //   console.log(value)
  //   db[key] = value
  // }

  // res.json(true)

  // V2 à plusieurs noeuds

  // - Appeler la commande `lookup` du nœud cible pour récupérer le nœud responsable de la valeur du nœud appelant sur l'anneau.
  // - Appeler la commande `add` du nœud responsable.
  // - Récupérer le prédécesseur du nœud responsable.
  // - Appeler la commande `add` du prédécesseur.
  // - Mettez à jour le successeur et le prédécesseur du nœud appelant.
  // - Copier les clefs dont le nœud est responsable.

  const lookup = await got(`${req.body.url}/lookup/${config.id}`).json()

  console.log('lookup', lookup)

  const predecessor = await got(`${lookup}/config/predecessor`).json()

  const add = await got.post({
    url: `${lookup}/add`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: config.url })
  })

  const addPredecessor = await got.post({
    url: `${predecessor.url}/add`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: config.url })
  })

  config.successor = {
    id: getIdFromString(lookup),
    url: lookup,
  }

  config.predecessor = {
    id: getIdFromString(predecessor.url),
    url: predecessor.url,
  }

  const keys = await got(`${lookup}/keys`).json()

  console.info('Syncing keys')

  console.log('Config:', config);

  res.json(true)
})

app.post('/add', (req, res) => {
  console.log('POST /add', req.body.url)

  // V1 à deux noeuds
  // config.successor = {
  //   id: getIdFromString(req.body.url),
  //   url: req.body.url,
  // }
  // config.predecessor = {
  //   id: getIdFromString(req.body.url),
  //   url: req.body.url,
  // }

  // V2 à plusieurs noeuds
  const id = getIdFromString(req.body.url)

  if (idIsInInterval(id, config.id, config.successor.id - 1)) {
    console.log('update successor', id, config.id, config.successor.id - 1);

    config.successor = {
      id,
      url: req.body.url,
    }
  }

  if (idIsInInterval(id, config.predecessor.id, config.id - 1)) {
    console.log('update predecessor', id, config.predecessor.id, config.id - 1);

    config.predecessor = {
      id,
      url: req.body.url,
    }
  }

  res.json(true)
})

// Lancement du serveur

console.log(`Server try run on port ${config.port}`)

app.listen(config.port, () => {
  console.log(`Listening on port ${config.port}`)
})
