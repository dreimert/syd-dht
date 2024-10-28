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

  res.json(db[req.params.key])
})

app.put('/db/:key', async (req, res) => {
  console.log('PUT /db', req.params.key, req.body.value)

  console.log('req', req);

  db[req.params.key] = req.body.value

  res.json(true)
})

app.get('/keys', (req, res) => {
  console.log('GET /keys')

  res.json(Object.keys(db))
})

app.get('/lookup/:id(\\d+)', async (req, res) => {
  console.log('GET /lookup', req.params.id)
  
  // idIsInInterval peut vous être utile ;)
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

// Lancement du serveur

console.log(`Server try run on port ${config.port}`)

app.listen(config.port, () => {
  console.log(`Listening on port ${config.port}`)
})
