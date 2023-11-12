#!/usr/bin/env node

import express from 'express'
import bodyParser from 'body-parser'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import crypto from 'crypto'

const argv = yargs(hideBin(process.argv))
  .options({
    port: {
      description: "Port d'écoute du noeud",
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

const app = express()
// @ts-ignore
const port = argv.port

const db = {
  test: "Hello World!", // Exemple d'initialisation, permet les premiers tests
}

const config = {
  port,
  url: `http://localhost:${port}`,
  id: 'TODO: Prenons un peu de <i>hash</i>',
  successor: {
    id: null,
    url: null,
  },
  predecessor: {
    id: null,
    url: null,
  },
}

// Pour exemple
function getHash(data) {
  return crypto.createHash('sha1').update(data, 'utf8').digest('hex');
}

// Je vous donne la fonction, elle est un peu compliquée ;)
// Convertie la clef vers un identifiant sur l'anneau de taille 2^m
function getIdFromString(data, m = argv.size) {
  // Calcul du hash et conversion en un buffer
  const buffer = crypto.createHash('sha1').update(data, 'utf8').digest()
  // Conversion du buffer en une chaine de m bits
  const bitString = Array.from(buffer).map(byte => byte.toString(2).padStart(8, '0')).join('').slice(-m)
  // Conversion de la chaine de bits en un entier
  return parseInt(bitString, 2)
}

// Pour parse les requêtes
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.get('/db/:key', (req, res) => {
  console.log('GET /db', req.params.key)

  res.json(db[req.params.key])
})

app.put('/db/:key', (req, res) => {
  console.log('PUT /db', req.params.key, req.body.value)

  console.log('req', req);

  db[req.params.key] = req.body.value

  res.json(true)
})

app.get('/lookup/:key', (req, res) => {
  console.log('GET /lookup', req.params.key)

  res.json('TODO')
})

app.get('/config/:key', (req, res) => {
  console.log('GET /config', req.params.key)

  res.json(config[req.params.key])
})

app.post('/join', (req, res) => {
  console.log('POST /join', req.body.url)

  res.json('TODO')
})

app.post('/add', (req, res) => {
  console.log('POST /add', req.body.url)

  res.json('TODO')
})

console.log(`Server try run on port ${port}`)

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})