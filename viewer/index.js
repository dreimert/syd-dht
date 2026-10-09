const center = { x: 398, y: 398 }
const radius = 340
const textRadius = 370
const responsibilityRadius = 300

/**
 * @type { HTMLCanvasElement }
 */ // @ts-ignore
const canvas = document.getElementById('canvas')
const configDisplay = document.getElementById('configs')
/**
 * @type { CanvasRenderingContext2D }
 */ // @ts-ignore
const ctx = canvas.getContext('2d')

ctx.font = "24px Arial";
ctx.textAlign = "center";
ctx.textBaseline = "middle";

// Draw a circle in center
function drawRing () {
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI)
  ctx.stroke()
  ctx.closePath()
}

drawRing()

function drawSmallCircle (x, y, color = 'red', size = 15) {
  ctx.beginPath()
  ctx.arc(x, y, size, 0, 2 * Math.PI)
  ctx.fillStyle = color
  ctx.fill()
  ctx.closePath()
}

function drawResponsibility (start, end, color = 'blue') {
  console.log('drawResponsibility', start, end, color);

  const defaultColor = ctx.strokeStyle

  console.log(start, end);

  ctx.beginPath()
  ctx.arc(center.x, center.y, responsibilityRadius, start, end)
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.closePath()

  ctx.strokeStyle = defaultColor
}

// Renvoie la configuration du nœud, ou null s'il est injoignable
async function fetchConfig (url) {
  try {
    const response = await fetch(`${url}/config`, { signal: AbortSignal.timeout(2000) })
    return await response.json()
  } catch {
    return null
  }
}

async function exploreDht (entryPoint) {
  /**
   * @type { { url: string, id?: number }[] }
   */
  const urls = [{ url: entryPoint }]
  const visited = new Set()
  /**
   * @type { {
   *   id: number,
   *   url: string,
   *   successor: { id: number, url: string },
   *   predecessor: { id: number, url: string },
   * }[] }
   **/
  const nodes = []
  /**
   * Nœuds cités comme voisins mais qui ne répondent pas
   * @type { { url: string, id?: number }[] }
   **/
  const deadNodes = []

  while (urls.length > 0) {
    const { url, id } = urls.pop()

    if (visited.has(url)) {
      continue
    }

    visited.add(url)

    const config = await fetchConfig(url)

    if (!config) {
      deadNodes.push({ url, id })
      continue
    }

    nodes.push(config)

    if (config.successor.url) {
      urls.push(config.successor)
    }

    if (config.predecessor.url) {
      urls.push(config.predecessor)
    }
  }

  return { size: nodes[0]?.size, nodes, deadNodes }
}

async function show () {
  clean()

  /**
   * @type { string }
   **/ // @ts-ignore
  const entryPoint = document.getElementById('entryPoint').value

  const data = await exploreDht(entryPoint)

  if (data.nodes.length === 0) {
    const errorEl = document.createElement('pre')
    errorEl.innerText = `${entryPoint} est injoignable`
    configDisplay.appendChild(errorEl)
    return
  }

  const nbPoints = Math.pow(2, data.size)
  const angle = 2 * Math.PI / nbPoints
  let index = 0

  for (const node of data.nodes) {
    const x = center.x + radius * Math.cos(node.id * angle)
    const y = center.y + radius * Math.sin(node.id * angle)

    drawSmallCircle(x, y)
    ctx.fillText(
      node.id.toString(),
      center.x + textRadius * Math.cos(node.id * angle),
      center.y + textRadius * Math.sin(node.id * angle)
    );
    drawResponsibility(
      (node.predecessor.id + 0.7) * angle,
      (node.id + 0.3) * angle,
      index % 2 === 0 ? 'blue' : 'green'
    );

    const configDisplayEl = document.createElement('pre')
    configDisplayEl.innerText = JSON.stringify(node, null, 2)
    configDisplay.appendChild(configDisplayEl)

    index++
  }

  for (const node of data.deadNodes) {
    if (typeof node.id === 'number') {
      drawSmallCircle(
        center.x + radius * Math.cos(node.id * angle),
        center.y + radius * Math.sin(node.id * angle),
        'grey'
      )
      ctx.fillText(
        `${node.id} ✝`,
        center.x + textRadius * Math.cos(node.id * angle),
        center.y + textRadius * Math.sin(node.id * angle)
      );
    }

    const configDisplayEl = document.createElement('pre')
    configDisplayEl.innerText = `${node.url} : injoignable`
    configDisplayEl.style.color = 'grey'
    configDisplay.appendChild(configDisplayEl)
  }
}

function clean () {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawRing()
  configDisplay.innerHTML = ''
}